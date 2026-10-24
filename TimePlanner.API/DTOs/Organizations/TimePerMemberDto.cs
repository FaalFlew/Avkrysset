namespace TimePlanner.API.DTOs.Organizations;

public class TimePerMemberDto
{
    public Guid MemberId { get; set; }
    public string DisplayName { get; set; } = string.Empty; // display name, or the email when none is set
    public string MemberEmail { get; set; } = string.Empty;
    public string MemberStatus { get; set; } = string.Empty; // "Active" | "Left" | "Removed"
    public double TotalHours { get; set; }
}
