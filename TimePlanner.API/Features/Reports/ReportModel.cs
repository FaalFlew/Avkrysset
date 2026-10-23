using System.Globalization;

namespace TimePlanner.API.Features.Reports;

public enum ReportKind
{
    Personal,
    Organization,
    Member
}

public enum ReportFormat
{
    Pdf,
    Csv
}

/// <summary>
/// Values of <c>ReportExports.Kind</c> (nvarchar(16)) besides the <see cref="ReportKind"/> names. Note: an
/// organization task list would not fit as "OrganizationTasks" (17 characters) without widening the column.
/// </summary>
public static class ReportExportKinds
{
    /// <summary>A personal task list CSV (GET /api/reports/personal.tasks.csv).</summary>
    public const string PersonalTasks = "PersonalTasks";
}

public enum PaperSize
{
    A4,
    Letter
}

/// <summary>
/// Everything a renderer needs to draw one analytics report, already computed and labelled.
/// Built by <see cref="ReportModelBuilder"/> from explicit inputs (no HttpContext), so the same model can
/// later come from a background job (scheduled/emailed reports).
/// </summary>
public sealed record ReportModel
{
    public required string DocumentId { get; init; }
    public required ReportKind Kind { get; init; }
    public required string Title { get; init; }

    /// <summary>Whose time the report shows: display name or email (personal/member), organization name (organization).</summary>
    public required string SubjectName { get; init; }
    public string? OrganizationName { get; init; }

    public required ReportSelection Selection { get; init; }

    /// <summary>Half-open range [RangeStartUtc, RangeEndUtc) of task starts.</summary>
    public required DateTime RangeStartUtc { get; init; }
    public required DateTime RangeEndUtc { get; init; }
    public required string RangeLabel { get; init; }

    /// <summary>IANA id the report was bucketed in ("UTC" when the requested zone was missing or unknown).</summary>
    public required string TimeZoneId { get; init; }
    public required TimeZoneInfo TimeZone { get; init; }
    /// <summary>e.g. "Europe/Oslo (UTC+02:00)", or "Europe/Oslo (UTC+01:00/+02:00)" when the offset changes in the range.</summary>
    public required string TimeZoneLabel { get; init; }

    /// <summary>
    /// The culture of the requested locale (invariant when missing or unknown). Decides the CSV delimiter and
    /// decimal separator and the default paper size.
    /// </summary>
    public required CultureInfo LocaleCulture { get; init; }

    /// <summary>
    /// Formats dates and numbers (labels stay English): <see cref="LocaleCulture"/>, or the invariant culture when
    /// the report fonts can't draw that culture's month/day names or number symbols (e.g. Thai, Devanagari).
    /// </summary>
    public required CultureInfo Culture { get; init; }
    public required PaperSize Paper { get; init; }
    public required DateTime GeneratedAtUtc { get; init; }

    public required ReportKpis Kpis { get; init; }
    /// <summary>Every bucket of the selection in order, zero-filled.</summary>
    public required IReadOnlyList<ReportPeriod> Periods { get; init; }
    /// <summary>Largest first.</summary>
    public required IReadOnlyList<ReportCategory> Categories { get; init; }
    /// <summary>Largest first; the "Without template" row is always last.</summary>
    public required IReadOnlyList<ReportTemplate> Templates { get; init; }
    /// <summary>Organization reports only (Phase 4); empty otherwise.</summary>
    public IReadOnlyList<ReportMember> Members { get; init; } = Array.Empty<ReportMember>();

    /// <summary>
    /// Every task of the range (the same rows the KPIs are computed from: count and summed hours are equal), ordered
    /// by start, then title (ordinal), then id (ordinal); see <see cref="ReportTaskList"/>.
    /// </summary>
    public IReadOnlyList<ReportTask> Tasks { get; init; } = Array.Empty<ReportTask>();

    /// <summary>Locale culture name for storage and logs ("invariant" for the invariant culture).</summary>
    public string CultureName => string.IsNullOrEmpty(LocaleCulture.Name) ? "invariant" : LocaleCulture.Name;
}

/// <param name="TopCategory">The category with the most hours; null when there are no tasks.</param>
public sealed record ReportKpis(
    double TotalHours,
    int TaskCount,
    int ActiveDays,
    double AverageHoursPerActiveDay,
    ReportCategory? TopCategory);

/// <param name="Key">"yyyy-MM", "yyyy-Www" or "yyyy-MM-dd" (same keys as the analytics API).</param>
/// <param name="Label">Full label, e.g. "October 2026", "Week 40", "Monday 5 October 2026" (culture-formatted dates).</param>
/// <param name="ShortLabel">Axis label, e.g. "Oct", "W40", "Mon 5".</param>
/// <param name="Color">Color of the period's dominant category; null for an empty period.</param>
public sealed record ReportPeriod(string Key, string Label, string ShortLabel, double Hours, string? Color);

/// <param name="Share">Fraction of the total hours (0-1).</param>
public sealed record ReportCategory(string Name, string Color, double Hours, double Share);

/// <param name="CategoryName">The template's category; null for "Without template" and deleted templates.</param>
public sealed record ReportTemplate(
    string Name,
    string? CategoryName,
    string? Color,
    double Hours,
    double Share,
    bool IsWithoutTemplate);

public sealed record ReportMember(string Name, string? Email, double Hours, double Share);

/// <summary>One row of the task list. Instants are UTC; renderers show them in the report's zone.</summary>
/// <param name="EndUtc">Start plus the duration (elapsed time, rounded to the millisecond like the frontend).</param>
/// <param name="Title">As stored (may be blank for legacy data).</param>
/// <param name="CategoryName">
/// As in the category breakdown: the task's category, or the organization's name for an organization task.
/// </param>
/// <param name="CategoryColor">The category's color, or the organization's <c>OrganizationPalette</c> color.</param>
/// <param name="TemplateTitle">Null without a template; "Deleted template" when the template no longer exists.</param>
/// <param name="OrganizationName">The organization of an organization task; null for a personal task.</param>
/// <param name="CreatedByDisplayName">The creator's display name, or their email when none is set.</param>
/// <param name="AssigneeNames">Display names (fallback email) of an organization task's assignees, ordinal order.</param>
public sealed record ReportTask(
    Guid Id,
    DateTime StartUtc,
    DateTime EndUtc,
    double DurationHours,
    string Title,
    string CategoryName,
    string CategoryColor,
    string? TemplateTitle,
    string? OrganizationName,
    string CreatedByDisplayName,
    Guid CreatedByUserId,
    IReadOnlyList<string> AssigneeNames,
    DateTime CreatedOnUtc);
