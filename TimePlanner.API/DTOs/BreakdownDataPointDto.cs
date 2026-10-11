namespace TimePlanner.API.DTOs;

public class BreakdownDataPointDto
{
    public string Label { get; set; } = string.Empty; // e.g., "January", "Week 5", "Mon 15"
    public double Value { get; set; } // e.g., Total hours
    public string DominantCategoryColor { get; set; } = "#A0AEC0"; // Default neutral color
}