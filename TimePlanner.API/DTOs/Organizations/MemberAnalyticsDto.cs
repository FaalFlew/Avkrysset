namespace TimePlanner.API.DTOs.Organizations;

public class MemberAnalyticsDto
{
    public Guid MemberId { get; set; }
    public string MemberEmail { get; set; } = string.Empty;
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public List<TimePerCategoryDto> TimePerCategory { get; set; } = new();
    public double TotalHours { get; set; }
}