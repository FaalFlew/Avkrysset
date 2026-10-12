namespace TimePlanner.API.DTOs.Organizations;


public class TimePerMemberDto
{
    public Guid MemberId { get; set; }
    public string MemberEmail { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty; // display name, or the email when none is set
    public double TotalHours { get; set; }
}