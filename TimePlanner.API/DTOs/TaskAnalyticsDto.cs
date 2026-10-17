using TimePlanner.API.DTOs;

public class TaskAnalyticsDto
{
    public double TotalHours { get; set; }
    public List<TimePerCategoryDto> TimePerCategory { get; set; } = new();
    public List<TimePerTemplateDto> TimePerTemplate { get; set; } = new();
    // ADDED: This new property will hold the data for the main bar chart.
    public List<BreakdownDataPointDto> BreakdownData { get; set; } = new();
}