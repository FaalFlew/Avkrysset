namespace Api.DTOs;

public class TaskTemplateDto
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public double Duration { get; set; }
    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string CategoryColor { get; set; } = string.Empty;
}