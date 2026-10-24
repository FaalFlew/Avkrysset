namespace TimePlanner.API.DTOs;

public class UpdateTaskTemplateRequest
{
    public string Title { get; set; } = string.Empty;
    public double Duration { get; set; }
    public Guid CategoryId { get; set; }
}