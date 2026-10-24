using FluentValidation;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Features.Reports;
using TimePlanner.API.Models.Organization;
using TimePerCategoryDto = TimePlanner.API.DTOs.Organizations.TimePerCategoryDto;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>
/// Shared by organization and member analytics: the selection is resolved in the organization's zone with the same
/// rules as reports (<see cref="ReportSelection"/>, <see cref="ReportModelBuilder.ResolveRange"/>) and bucketed with
/// <see cref="TaskAnalyticsBreakdown"/>, so the numbers match the Phase 4 organization reports. The browser never
/// computes organization ranges (it only knows the device zone).
/// </summary>
public static class OrganizationAnalytics
{
    /// <summary>The resolved selection: half-open UTC range [StartUtc, EndUtc) in the organization's zone.</summary>
    public sealed record Range(ReportSelection Selection, string TimeZoneId, TimeZoneInfo Zone, DateTime StartUtc, DateTime EndUtc);

    /// <summary>An organization task starting in the range, with its assignees.</summary>
    public sealed record TaskRow(Guid Id, DateTime Start, double Duration, Guid CategoryId, string CategoryName, string CategoryColor, List<Guid> AssigneeIds)
    {
        public AnalyticsTaskRow ToAnalyticsRow() => new(Start, Duration, CategoryId, CategoryName, CategoryColor, null);
    }

    /// <summary>Adds one failure per problem with the view/year/from/to query values.</summary>
    public static void AddSelectionRule<T>(AbstractValidator<T> validator, Func<T, (string? View, int? Year, int? From, int? To)> selection) =>
        validator.RuleFor(q => q).Custom((query, context) =>
        {
            var (view, year, from, to) = selection(query);
            ReportSelection.TryCreate(view, year, from, to, out var errors);
            foreach (var error in errors)
            {
                context.AddFailure(error);
            }
        });

    /// <summary>The organization's zone (UTC if it can't be resolved) and the selection's range in it; 400 for an invalid selection.</summary>
    public static async Task<Range> ResolveAsync(
        ApplicationDbContext context, Guid organizationId, string? view, int? year, int? from, int? to,
        ILogger logger, CancellationToken cancellationToken)
    {
        // The validator has already reported problems; this only turns the raw values into the selection.
        var selection = ReportSelection.TryCreate(view, year, from, to, out var errors)
                        ?? throw new BadRequestException(string.Join(" ", errors), errors);
        var (zoneId, zone) = await ZoneAsync(context, organizationId, logger, cancellationToken);
        var (startUtc, endUtc) = ReportModelBuilder.ResolveRange(selection, zone);
        return new Range(selection, zoneId, zone, startUtc, endUtc);
    }

    public static async Task<(string Id, TimeZoneInfo Zone)> ZoneAsync(
        ApplicationDbContext context, Guid organizationId, ILogger logger, CancellationToken cancellationToken)
    {
        var stored = await context.Organizations
            .Where(o => o.Id == organizationId)
            .Select(o => o.TimeZoneId)
            .SingleAsync(cancellationToken);
        return ReportModelBuilder.ResolveZone(stored, logger);
    }

    /// <summary>The organization's tasks starting in the range (only those assigned to <paramref name="assignedTo"/> when set).</summary>
    public static async Task<List<TaskRow>> LoadTasksAsync(
        ApplicationDbContext context, Guid organizationId, Range range, Guid? assignedTo, CancellationToken cancellationToken)
    {
        var query = context.Tasks
            .AsNoTracking()
            .Where(t => t.OrganizationId == organizationId && t.Start >= range.StartUtc && t.Start < range.EndUtc);

        if (assignedTo is Guid memberId)
        {
            query = query.Where(t => t.Assignments.Any(a => a.AssigneeId == memberId));
        }

        var rows = await query
            .Select(t => new
            {
                t.Id,
                t.Start,
                t.Duration,
                t.CategoryId,
                CategoryName = t.Category.Name,
                CategoryColor = t.Category.Color,
                Assignees = t.Assignments.Select(a => a.AssigneeId).ToList()
            })
            .ToListAsync(cancellationToken);

        return rows
            .Select(r => new TaskRow(r.Id, r.Start, r.Duration, r.CategoryId, r.CategoryName, r.CategoryColor, r.Assignees))
            .ToList();
    }

    /// <summary>Fills the fields shared by organization and member analytics from <paramref name="tasks"/>.</summary>
    public static T Fill<T>(T dto, Guid organizationId, Range range, IReadOnlyCollection<TaskRow> tasks)
        where T : OrganizationAnalyticsSummaryDto
    {
        var rows = tasks.Select(t => t.ToAnalyticsRow()).ToList();

        dto.OrganizationId = organizationId;
        dto.TimeZoneId = range.TimeZoneId;
        dto.TimeZoneLabel = ReportFormatting.ZoneLabel(range.TimeZoneId, range.Zone, range.StartUtc, range.EndUtc);
        dto.View = range.Selection.View;
        dto.RangeStartUtc = range.StartUtc;
        dto.RangeEndUtc = range.EndUtc;
        dto.TotalHours = rows.Sum(r => r.Duration);
        dto.TaskCount = rows.Count;
        dto.TimePerCategory = AnalyticsOrder.Sort(
            rows
                .GroupBy(r => r.CategoryId)
                .Select(g => new TimePerCategoryDto
                {
                    CategoryId = g.Key,
                    CategoryName = g.First().CategoryName,
                    CategoryColor = g.First().CategoryColor,
                    TotalHours = g.Sum(r => r.Duration)
                }),
            c => c.TotalHours, c => c.CategoryName, c => c.CategoryId);
        dto.BreakdownData = ZeroFilledBreakdown(rows, range);
        return dto;
    }

    /// <summary>Every bucket of the selection in order; buckets without tasks have value 0 and the neutral colour.</summary>
    public static List<BreakdownDataPointDto> ZeroFilledBreakdown(IEnumerable<AnalyticsTaskRow> rows, Range range)
    {
        var points = TaskAnalyticsBreakdown.Build(rows, range.Selection.View, range.Zone).ToDictionary(p => p.Key, StringComparer.Ordinal);

        return TaskAnalyticsBreakdown.EnumerateBuckets(range.StartUtc, range.EndUtc, range.Selection.View, range.Zone)
            .Select(bucket => points.TryGetValue(bucket.Key, out var point)
                ? point
                : new BreakdownDataPointDto { Key = bucket.Key, Label = bucket.Label, Value = 0 })
            .ToList();
    }

    /// <summary>A person's name, email and membership status in the organization (status "Removed" if no membership row is left).</summary>
    public sealed record Person(Guid Id, string Email, string DisplayName, string Status);

    public static async Task<Dictionary<Guid, Person>> PeopleAsync(
        ApplicationDbContext context, Guid organizationId, IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken)
    {
        if (userIds.Count == 0)
        {
            return new Dictionary<Guid, Person>();
        }

        var people = await context.Users
            .AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .Select(u => new
            {
                u.Id,
                Email = u.Email!,
                DisplayName = u.DisplayName ?? u.Email!,
                Status = context.OrganizationMemberships
                    .Where(m => m.OrganizationId == organizationId && m.UserId == u.Id)
                    .Select(m => m.Status)
                    .FirstOrDefault()
            })
            .ToListAsync(cancellationToken);

        return people.ToDictionary(p => p.Id, p => new Person(p.Id, p.Email, p.DisplayName, p.Status ?? MembershipStatus.Removed));
    }
}
