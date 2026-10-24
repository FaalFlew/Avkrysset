namespace TimePlanner.API.DTOs;

public class TaskTemplateDto
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public double Duration { get; set; }
    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty; // Useful for the frontend
    public string CategoryColor { get; set; } = string.Empty; // Useful for the frontend
}