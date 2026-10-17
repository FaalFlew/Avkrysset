using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Features.Queries.Tasks;

namespace TimePlanner.API.Features.Reports;

/// <summary>
/// A planner task as loaded for a report: <see cref="Row"/> is what the analytics are computed from (start, duration,
/// category as on the analytics page, template), the other fields are what the task list shows.
/// </summary>
/// <param name="OrganizationName">The organization of an organization task; null for a personal task.</param>
/// <param name="CreatedByDisplayName">The creator's display name, or their email when none is set.</param>
/// <param name="AssigneeNames">Display names (fallback email) of the assignees; empty for a personal task.</param>
public sealed record ReportTaskSource(
    Guid Id,
    string Title,
    AnalyticsTaskRow Row,
    string? OrganizationName,
    Guid CreatedByUserId,
    string CreatedByDisplayName,
    IReadOnlyList<string> AssigneeNames,
    DateTime CreatedOnUtc);

/// <summary>One local calendar day of the task list: its tasks in list order, their count and summed hours.</summary>
public sealed record ReportTaskDay(DateTime Day, IReadOnlyList<ReportTask> Tasks, double Hours);

/// <summary>
/// The task list of a report (docs/plans/analytics-task-list.md), shared by the PDF section and the task CSV and
/// matched by the analytics page: the tasks the analytics are computed from, ordered by start, then title, then id.
/// A task belongs to the local day (in the report's zone) of its start; its end gets the planner's "+1d" marker when
/// it ends on a later local day.
/// </summary>
public static class ReportTaskList
{
    /// <summary>The PDF lists at most this many tasks (and says so); the task CSV always has all of them.</summary>
    public const int MaxPdfRows = 5000;

    /// <summary>Shown in the PDF for a blank title (legacy data), like the planner.</summary>
    public const string UntitledTask = "Untitled task";

    private const double MillisecondsPerHour = 3_600_000;

    /// <summary>
    /// The user's planner tasks (<see cref="AnalyticsTaskRows.PlannerTasks"/>) of [startUtc, endUtc) with everything
    /// the task list shows, in one query (assignee names included: no query per task).
    /// </summary>
    public static async Task<List<ReportTaskSource>> ForPlannerAsync(
        ApplicationDbContext context, Guid userId, DateTime startUtc, DateTime endUtc, CancellationToken cancellationToken)
    {
        var rows = await AnalyticsTaskRows.PlannerTasks(context, userId, startUtc, endUtc)
            .Select(t => new
            {
                t.Id,
                t.Title,
                t.Start,
                t.Duration,
                t.CategoryId,
                CategoryName = t.Category.Name,
                CategoryColor = t.Category.Color,
                t.TemplateId,
                t.OrganizationId,
                OrganizationName = t.Organization != null ? t.Organization.Name : null,
                CreatedByUserId = t.UserId,
                // Same names as the task API (TaskProjections): display name, else email.
                CreatedBy = t.User.DisplayName ?? t.User.Email,
                Assignees = t.Assignments.Select(a => a.Assignee.DisplayName ?? a.Assignee.Email).ToList(),
                t.CreatedOnUtc
            })
            .ToListAsync(cancellationToken);

        return rows
            .Select(r => new ReportTaskSource(
                r.Id,
                r.Title,
                AnalyticsTaskRow.ForPlannerTask(
                    r.Start, r.Duration, r.CategoryId, r.CategoryName, r.CategoryColor, r.TemplateId, r.OrganizationId, r.OrganizationName),
                r.OrganizationId is null ? null : r.OrganizationName ?? AnalyticsTaskRows.UnnamedOrganization,
                r.CreatedByUserId,
                r.CreatedBy ?? "",
                r.Assignees.OfType<string>().Order(StringComparer.Ordinal).ToList(),
                r.CreatedOnUtc))
            .ToList();
    }

    /// <summary>
    /// List order: start ascending, then title in ordinal order, then the id's lower-case "D" string, also ordinal
    /// (the same as JavaScript's &lt; on strings, so the analytics page sorts identically).
    /// </summary>
    public static List<T> Order<T>(IEnumerable<T> items, Func<T, DateTime> startUtc, Func<T, string> title, Func<T, Guid> id) =>
        items
            .OrderBy(startUtc)
            .ThenBy(title, StringComparer.Ordinal)
            .ThenBy(item => id(item).ToString("D"), StringComparer.Ordinal)
            .ToList();

    /// <summary>The list row of <paramref name="source"/>; its template title comes from <paramref name="templates"/>.</summary>
    public static ReportTask ToTask(ReportTaskSource source, IReadOnlyDictionary<Guid, AnalyticsTemplate> templates)
    {
        var row = source.Row;
        var startUtc = DateTime.SpecifyKind(row.Start, DateTimeKind.Utc);
        var templateTitle = row.TemplateId is Guid templateId
            ? templates.TryGetValue(templateId, out var template) ? template.Title : ReportModelBuilder.DeletedTemplate
            : null;

        return new ReportTask(
            source.Id,
            startUtc,
            EndOf(startUtc, row.Duration),
            row.Duration,
            source.Title,
            row.CategoryName,
            row.CategoryColor,
            templateTitle,
            source.OrganizationName,
            source.CreatedByDisplayName,
            source.CreatedByUserId,
            source.AssigneeNames,
            DateTime.SpecifyKind(source.CreatedOnUtc, DateTimeKind.Utc));
    }

    /// <summary>
    /// Start plus <paramref name="hours"/> of elapsed time, rounded to the millisecond with JavaScript's Math.round
    /// (the frontend's <c>endInstant</c>), so both sides show the same end.
    /// </summary>
    public static DateTime EndOf(DateTime startUtc, double hours)
    {
        var milliseconds = Math.Floor((double.IsFinite(hours) ? hours : 0) * MillisecondsPerHour + 0.5);
        return DateTime.SpecifyKind(startUtc, DateTimeKind.Utc).AddMilliseconds(milliseconds);
    }

    public static DateTime LocalStart(ReportTask task, TimeZoneInfo timeZone) => TaskAnalyticsBreakdown.ToLocal(task.StartUtc, timeZone);

    public static DateTime LocalEnd(ReportTask task, TimeZoneInfo timeZone) => TaskAnalyticsBreakdown.ToLocal(task.EndUtc, timeZone);

    /// <summary>The day a task belongs to: the local date of its start.</summary>
    public static DateTime LocalDay(ReportTask task, TimeZoneInfo timeZone) => LocalStart(task, timeZone).Date;

    /// <summary>
    /// How many local days after its start day a task ends, as in the planner (plannerFormat.ts taskEndDayOffset):
    /// the last minute it occupies decides, so a task 23:00–00:00 ends on its start day.
    /// </summary>
    public static int EndDayOffset(ReportTask task, TimeZoneInfo timeZone)
    {
        var lastMinuteDay = TaskAnalyticsBreakdown.ToLocal(task.EndUtc.AddMinutes(-1), timeZone).Date;
        return Math.Max(0, (lastMinuteDay - LocalDay(task, timeZone)).Days);
    }

    /// <summary>"+1d", "+2d", … for a task that ends on a later local day; "" otherwise.</summary>
    public static string EndDayMarker(ReportTask task, TimeZoneInfo timeZone)
    {
        var days = EndDayOffset(task, timeZone);
        return days > 0 ? $"+{days}d" : "";
    }

    /// <summary>The tasks grouped by local start day, in list order, with each day's task count and hours.</summary>
    public static List<ReportTaskDay> Days(IEnumerable<ReportTask> tasks, TimeZoneInfo timeZone) =>
        tasks
            .GroupBy(task => LocalDay(task, timeZone))
            .Select(day =>
            {
                var list = day.ToList();
                return new ReportTaskDay(day.Key, list, list.Sum(task => task.DurationHours));
            })
            .ToList();
}
