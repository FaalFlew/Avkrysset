namespace TimePlanner.API.DTOs;

public class BreakdownDataPointDto
{
    // Stable bucket id in the client's time zone: "yyyy-MM" (monthly), "yyyy-Www" ISO week (weekly), "yyyy-MM-dd" (daily).
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty; // e.g., "January", "Week 5", "Monday"
    public double Value { get; set; } // e.g., Total hours
    public string DominantCategoryColor { get; set; } = "#A0AEC0"; // Default neutral color
}
