namespace TimePlanner.API.DTOs.Organizations;


public class TimePerMemberDto
{
    public Guid MemberId { get; set; }
    public string MemberEmail { get; set; } = string.Empty;
    public double TotalHours { get; set; }
}