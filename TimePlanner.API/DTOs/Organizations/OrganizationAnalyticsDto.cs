namespace TimePlanner.API.DTOs.Organizations;

/// <summary>
/// What organization and member analytics share. The selection (view, year, from, to) is resolved and bucketed in the
/// organization's time zone; the caller's X-Time-Zone header is ignored. A task counts by its start instant.
/// </summary>
public abstract class OrganizationAnalyticsSummaryDto
{
    public Guid OrganizationId { get; set; }
    public string TimeZoneId { get; set; } = "UTC"; // the organization's IANA zone
    public string TimeZoneLabel { get; set; } = "UTC"; // e.g. "America/New_York (UTC-05:00/-04:00)" (ReportFormatting.ZoneLabel)
    public string View { get; set; } = string.Empty; // "monthly" | "weekly" | "daily"
    public DateTime RangeStartUtc { get; set; } // half-open [RangeStartUtc, RangeEndUtc)
    public DateTime RangeEndUtc { get; set; }
    public double TotalHours { get; set; } // sum of task durations, each task counted once
    public int TaskCount { get; set; }

    // Categories are the task creators' personal categories (decision Q2). Order: AnalyticsOrder (hours desc, name, id).
    public List<TimePerCategoryDto> TimePerCategory { get; set; } = new();

    // Zero-filled: every bucket of the selection, in order (keys as in personal analytics).
    public List<BreakdownDataPointDto> BreakdownData { get; set; } = new();
}

public class OrganizationAnalyticsDto : OrganizationAnalyticsSummaryDto
{
    // Person-hours: a task's duration counted once per assignee (= the sum of TimePerMember).
    public double AssignedHours { get; set; }

    // Everyone assigned to a task in the range, including people who left or were removed.
    // Order: hours desc, then display name, then id.
    public List<TimePerMemberDto> TimePerMember { get; set; } = new();
}
