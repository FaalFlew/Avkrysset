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
