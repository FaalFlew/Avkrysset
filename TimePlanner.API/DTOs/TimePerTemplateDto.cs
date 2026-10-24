namespace TimePlanner.API.DTOs;

public class TimePerTemplateDto
{
    public Guid? TemplateId { get; set; }
    public string? TemplateTitle { get; set; } // Template title (nullable if no template)
    public string? CategoryColor { get; set; } // Color of the template’s category
    public double TotalHours { get; set; }
}