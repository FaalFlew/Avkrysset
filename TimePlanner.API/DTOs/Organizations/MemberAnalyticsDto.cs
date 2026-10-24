namespace TimePlanner.API.DTOs.Organizations;

/// <summary>One member's analytics: the organization's tasks assigned to them (see <see cref="OrganizationAnalyticsSummaryDto"/>).</summary>
public class MemberAnalyticsDto : OrganizationAnalyticsSummaryDto
{
    public Guid MemberId { get; set; }
    public string DisplayName { get; set; } = string.Empty; // display name, or the email when none is set
    public string MemberEmail { get; set; } = string.Empty;
    public string MemberStatus { get; set; } = string.Empty; // "Active" | "Left" | "Removed"
}
