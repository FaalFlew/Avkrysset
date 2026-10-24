
namespace TimePlanner.API.DTOs.Organizations;

public class OrganizationAnalyticsDto
{
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public List<TimePerCategoryDto> TimePerCategory { get; set; } = new();
    public List<TimePerMemberDto> TimePerMember { get; set; } = new();
    public double TotalHours { get; set; }
}