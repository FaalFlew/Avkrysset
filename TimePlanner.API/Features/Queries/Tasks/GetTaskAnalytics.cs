using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Tasks;

// StartDate/EndDate: half-open range [StartDate, EndDate) of UTC instants.
// ViewType: "monthly" | "weekly" | "daily" - how the breakdown is grouped.
// TimeZoneId: the caller's IANA zone (X-Time-Zone header) whose calendar is used for grouping; null means UTC.
public record GetTaskAnalyticsQuery(DateTime StartDate, DateTime EndDate, string ViewType, string? TimeZoneId = null)
    : IRequest<TaskAnalyticsDto>;

// The task columns analytics need. Start is a UTC instant.
public sealed record AnalyticsTaskRow(
    DateTime Start,
    double Duration,
    Guid CategoryId,
    string CategoryName,
    string CategoryColor,
    Guid? TemplateId)
{
    // An organization task assigned to the user counts under the organization's name and palette color
    // (its category belongs to whoever created it). The organization id stands in as the category id.
    public static AnalyticsTaskRow ForOrganizationTask(DateTime start, double duration, Guid organizationId, string organizationName) =>
        new(start, duration, organizationId, organizationName, OrganizationPalette.ColorFor(organizationId), null);
}

public class GetTaskAnalyticsQueryHandler
    : IRequestHandler<GetTaskAnalyticsQuery, TaskAnalyticsDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<GetTaskAnalyticsQueryHandler> _logger;

    public GetTaskAnalyticsQueryHandler(
        ApplicationDbContext context,
        ICurrentUserService currentUserService,
        ILogger<GetTaskAnalyticsQueryHandler> logger)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
    }

    public async Task<TaskAnalyticsDto> Handle(GetTaskAnalyticsQuery request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        var timeZone = TimeZoneResolver.ResolveOrUtc(request.TimeZoneId, _logger);

        // The user's planner: personal tasks + organization tasks assigned to them (active memberships only).
        var rows = await _context.Tasks
            .AsNoTracking()
            .Where(PlannerScope.ForUser(_context, userId.Value))
            .Where(t => t.Start >= request.StartDate && t.Start < request.EndDate)
            .Select(t => new
            {
                t.Start,
                t.Duration,
                t.CategoryId,
                CategoryName = t.Category.Name,
                CategoryColor = t.Category.Color,
                t.TemplateId,
                t.OrganizationId,
                OrganizationName = t.Organization != null ? t.Organization.Name : null
            })
            .ToListAsync(cancellationToken);

        var tasks = rows
            .Select(r => r.OrganizationId is Guid organizationId
                ? AnalyticsTaskRow.ForOrganizationTask(r.Start, r.Duration, organizationId, r.OrganizationName ?? "Organization")
                : new AnalyticsTaskRow(r.Start, r.Duration, r.CategoryId, r.CategoryName, r.CategoryColor, r.TemplateId))
            .ToList();

        var totalHours = tasks.Sum(t => t.Duration);

        var timePerCategory = tasks
            .GroupBy(t => t.CategoryId)
            .Select(g => new TimePerCategoryDto
            {
                CategoryId = g.Key,
                CategoryName = g.First().CategoryName,
                CategoryColor = g.First().CategoryColor,
                TotalHours = g.Sum(x => x.Duration)
            }).ToList();

        // One query for all templates used in the range.
        var templateIds = tasks
            .Where(t => t.TemplateId.HasValue)
            .Select(t => t.TemplateId!.Value)
            .Distinct()
            .ToList();

        var templates = templateIds.Count == 0
            ? new Dictionary<Guid, (string Title, string CategoryColor)>()
            : (await _context.TaskTemplates
                .AsNoTracking()
                .Where(tt => templateIds.Contains(tt.Id))
                .Select(tt => new { tt.Id, tt.Title, CategoryColor = tt.Category.Color })
                .ToListAsync(cancellationToken))
                .ToDictionary(tt => tt.Id, tt => (tt.Title, tt.CategoryColor));

        var timePerTemplate = tasks
            .Where(t => t.TemplateId.HasValue)
            .GroupBy(t => t.TemplateId!.Value)
            .Select(g =>
            {
                var found = templates.TryGetValue(g.Key, out var template);
                return new TimePerTemplateDto
                {
                    TemplateId = g.Key,
                    TemplateTitle = found ? template.Title : null,
                    CategoryColor = found ? template.CategoryColor : null,
                    TotalHours = g.Sum(x => x.Duration)
                };
            }).ToList();

        return new TaskAnalyticsDto
        {
            TotalHours = totalHours,
            TimePerCategory = timePerCategory,
            TimePerTemplate = timePerTemplate,
            BreakdownData = TaskAnalyticsBreakdown.Build(tasks, request.ViewType, timeZone)
        };
    }
}

/// <summary>
/// Groups tasks into calendar buckets of the caller's time zone (by task start).
/// Keys: "yyyy-MM" (monthly), ISO week "yyyy-Www" e.g. "2026-W05" (weekly), "yyyy-MM-dd" (daily).
/// Results are ordered chronologically by key (daily is therefore Monday-first for an ISO week).
/// </summary>
public static class TaskAnalyticsBreakdown
{
    public const string Monthly = "monthly";
    public const string Weekly = "weekly";
    public const string Daily = "daily";

    private const string DefaultColor = "#A0AEC0";

    public static bool IsSupportedViewType([NotNullWhen(true)] string? viewType) =>
        string.Equals(viewType, Monthly, StringComparison.OrdinalIgnoreCase)
        || string.Equals(viewType, Weekly, StringComparison.OrdinalIgnoreCase)
        || string.Equals(viewType, Daily, StringComparison.OrdinalIgnoreCase);

    public static List<BreakdownDataPointDto> Build(
        IEnumerable<AnalyticsTaskRow> tasks, string? viewType, TimeZoneInfo timeZone)
    {
        Func<DateTime, (string Key, string Label)>? bucketOf = viewType?.ToLowerInvariant() switch
        {
            Monthly => MonthBucket,
            Weekly => WeekBucket,
            Daily => DayBucket,
            _ => null
        };

        if (bucketOf is null)
        {
            return new List<BreakdownDataPointDto>();
        }

        return tasks
            .GroupBy(t => bucketOf(ToLocal(t.Start, timeZone)))
            .OrderBy(g => g.Key.Key, StringComparer.Ordinal)
            .Select(g => new BreakdownDataPointDto
            {
                Key = g.Key.Key,
                Label = g.Key.Label,
                Value = g.Sum(t => t.Duration),
                DominantCategoryColor = GetDominantColor(g)
            })
            .ToList();
    }

    /// <summary>Wall-clock time of a UTC instant in <paramref name="timeZone"/>.</summary>
    public static DateTime ToLocal(DateTime utcInstant, TimeZoneInfo timeZone) =>
        TimeZoneInfo.ConvertTimeFromUtc(
            utcInstant.Kind == DateTimeKind.Local
                ? utcInstant.ToUniversalTime()
                : DateTime.SpecifyKind(utcInstant, DateTimeKind.Utc),
            timeZone);

    public static (string Key, string Label) MonthBucket(DateTime local) =>
        (local.ToString("yyyy-MM", CultureInfo.InvariantCulture),
         CultureInfo.InvariantCulture.DateTimeFormat.GetMonthName(local.Month));

    public static (string Key, string Label) WeekBucket(DateTime local)
    {
        var isoYear = ISOWeek.GetYear(local);
        var week = ISOWeek.GetWeekOfYear(local);
        return (string.Create(CultureInfo.InvariantCulture, $"{isoYear:D4}-W{week:D2}"),
                string.Create(CultureInfo.InvariantCulture, $"Week {week}"));
    }

    public static (string Key, string Label) DayBucket(DateTime local) =>
        (local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), local.DayOfWeek.ToString());

    // The color of the category with the most hours in the bucket.
    private static string GetDominantColor(IEnumerable<AnalyticsTaskRow> tasks)
    {
        var dominant = tasks
            .GroupBy(t => t.CategoryId)
            .Select(g => new { TotalDuration = g.Sum(t => t.Duration), g.First().CategoryColor })
            .OrderByDescending(x => x.TotalDuration)
            .FirstOrDefault();

        return dominant?.CategoryColor ?? DefaultColor;
    }
}
