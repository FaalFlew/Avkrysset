namespace TimePlanner.API.DTOs.Organizations;

public class TimePerCategoryDto
{
    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string CategoryColor { get; set; } = string.Empty;
    public double TotalHours { get; set; }
}