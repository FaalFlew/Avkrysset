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

        var tasks = await AnalyticsTaskRows.ForPlannerAsync(
            _context, userId.Value, request.StartDate, request.EndDate, cancellationToken);

        var totalHours = tasks.Sum(t => t.Duration);

        var timePerCategory = AnalyticsOrder.Sort(
            tasks
                .GroupBy(t => t.CategoryId)
                .Select(g => new TimePerCategoryDto
                {
                    CategoryId = g.Key,
                    CategoryName = g.First().CategoryName,
                    CategoryColor = g.First().CategoryColor,
                    TotalHours = g.Sum(x => x.Duration)
                }),
            c => c.TotalHours, c => c.CategoryName, c => c.CategoryId);

        var templates = await AnalyticsTaskRows.TemplatesOfAsync(_context, tasks, cancellationToken);

        var timePerTemplate = AnalyticsOrder.Sort(
            tasks
                .Where(t => t.TemplateId.HasValue)
                .GroupBy(t => t.TemplateId!.Value)
                .Select(g =>
                {
                    templates.TryGetValue(g.Key, out var template);
                    return new TimePerTemplateDto
                    {
                        TemplateId = g.Key,
                        TemplateTitle = template?.Title,
                        CategoryColor = template?.CategoryColor,
                        TotalHours = g.Sum(x => x.Duration)
                    };
                }),
            t => t.TotalHours, t => t.TemplateTitle ?? AnalyticsOrder.DeletedTemplateName, t => t.TemplateId ?? Guid.Empty);

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
/// The one ordering for category and template lists, shared by the analytics API, reports and the frontend
/// (which renders the API order): hours descending, then name in ordinal (UTF-16 code unit) order, the same as
/// JavaScript's <c>&lt;</c> on strings, then the id's lower-case "D" string, also ordinal. Hours are compared at
/// 6 decimals so floating-point summation noise never decides a tie. The first category is the "top category".
/// Reports add "Without template" after the sorted templates.
/// </summary>
public static class AnalyticsOrder
{
    /// <summary>Name used (and sorted by) for templates that were deleted.</summary>
    public const string DeletedTemplateName = "Deleted template";

    public static List<T> Sort<T>(IEnumerable<T> items, Func<T, double> hours, Func<T, string> name, Func<T, Guid> id) =>
        items
            .OrderByDescending(item => HoursKey(hours(item)))
            .ThenBy(name, StringComparer.Ordinal)
            .ThenBy(item => id(item).ToString("D"), StringComparer.Ordinal)
            .ToList();

    /// <summary>Hours as compared for ordering (rounded to 6 decimals).</summary>
    public static double HoursKey(double hours) => double.IsFinite(hours) ? Math.Round(hours, 6) : 0;
}

/// <summary>A template referenced by analytics rows (soft-deleted templates are not found).</summary>
public sealed record AnalyticsTemplate(string Title, string CategoryName, string CategoryColor);

/// <summary>Loads the rows that personal analytics and personal reports are computed from.</summary>
public static class AnalyticsTaskRows
{
    /// <summary>
    /// The user's planner tasks (personal tasks + organization tasks assigned to them, active memberships only)
    /// starting in the half-open UTC range [startUtc, endUtc). Organization tasks count under the organization.
    /// </summary>
    public static async Task<List<AnalyticsTaskRow>> ForPlannerAsync(
        ApplicationDbContext context, Guid userId, DateTime startUtc, DateTime endUtc, CancellationToken cancellationToken)
    {
        var rows = await context.Tasks
            .AsNoTracking()
            .Where(PlannerScope.ForUser(context, userId))
            .Where(t => t.Start >= startUtc && t.Start < endUtc)
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

        return rows
            .Select(r => r.OrganizationId is Guid organizationId
                ? AnalyticsTaskRow.ForOrganizationTask(r.Start, r.Duration, organizationId, r.OrganizationName ?? "Organization")
                : new AnalyticsTaskRow(r.Start, r.Duration, r.CategoryId, r.CategoryName, r.CategoryColor, r.TemplateId))
            .ToList();
    }

    /// <summary>One query for all templates used by <paramref name="tasks"/>.</summary>
    public static async Task<Dictionary<Guid, AnalyticsTemplate>> TemplatesOfAsync(
        ApplicationDbContext context, IEnumerable<AnalyticsTaskRow> tasks, CancellationToken cancellationToken)
    {
        var templateIds = tasks
            .Where(t => t.TemplateId.HasValue)
            .Select(t => t.TemplateId!.Value)
            .Distinct()
            .ToList();

        if (templateIds.Count == 0)
        {
            return new Dictionary<Guid, AnalyticsTemplate>();
        }

        return (await context.TaskTemplates
                .AsNoTracking()
                .Where(tt => templateIds.Contains(tt.Id))
                .Select(tt => new { tt.Id, tt.Title, CategoryName = tt.Category.Name, CategoryColor = tt.Category.Color })
                .ToListAsync(cancellationToken))
            .ToDictionary(tt => tt.Id, tt => new AnalyticsTemplate(tt.Title, tt.CategoryName, tt.CategoryColor));
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

    /// <summary>
    /// Every bucket of <paramref name="viewType"/> that overlaps the half-open UTC range [startUtc, endUtc), in
    /// chronological order, with the same keys and labels as <see cref="Build"/> (used to zero-fill a breakdown).
    /// Bucket boundaries are local midnights of <paramref name="timeZone"/> (see <see cref="ZonedTime.ToUtc"/>).
    /// </summary>
    public static List<(string Key, string Label, DateTime StartUtc)> EnumerateBuckets(
        DateTime startUtc, DateTime endUtc, string? viewType, TimeZoneInfo timeZone)
    {
        var buckets = new List<(string Key, string Label, DateTime StartUtc)>();
        if (!IsSupportedViewType(viewType) || startUtc >= endUtc)
        {
            return buckets;
        }

        var view = viewType.ToLowerInvariant();
        var firstDay = ToLocal(startUtc, timeZone).Date;
        var cursor = view switch
        {
            Monthly => new DateTime(firstDay.Year, firstDay.Month, 1),
            Weekly => firstDay.AddDays(-(((int)firstDay.DayOfWeek + 6) % 7)), // the ISO week's Monday
            _ => firstDay
        };

        // A year of days is ~370 buckets; the cap only guards against a runaway loop.
        for (var guard = 0; guard < 2000; guard++)
        {
            var next = view switch
            {
                Monthly => cursor.AddMonths(1),
                Weekly => cursor.AddDays(7),
                _ => cursor.AddDays(1)
            };

            var bucketStartUtc = ZonedTime.ToUtc(cursor, timeZone);
            if (bucketStartUtc >= endUtc)
            {
                break;
            }

            if (ZonedTime.ToUtc(next, timeZone) > startUtc)
            {
                var (key, label) = view switch
                {
                    Monthly => MonthBucket(cursor),
                    Weekly => WeekBucket(cursor),
                    _ => DayBucket(cursor)
                };
                buckets.Add((key, label, bucketStartUtc));
            }

            cursor = next;
        }

        return buckets;
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
    // Ties are broken like the category list (AnalyticsOrder), so the color doesn't depend on row order.
    private static string GetDominantColor(IEnumerable<AnalyticsTaskRow> tasks)
    {
        var dominant = AnalyticsOrder.Sort(
                tasks
                    .GroupBy(t => t.CategoryId)
                    .Select(g => new
                    {
                        g.Key,
                        TotalDuration = g.Sum(t => t.Duration),
                        g.First().CategoryName,
                        g.First().CategoryColor
                    }),
                x => x.TotalDuration, x => x.CategoryName, x => x.Key)
            .FirstOrDefault();

        return dominant?.CategoryColor ?? DefaultColor;
    }
}
