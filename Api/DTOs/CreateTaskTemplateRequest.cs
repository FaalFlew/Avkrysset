namespace Api.DTOs;

public class CreateTaskTemplateRequest
{
    public string Title { get; set; } = string.Empty;
    public double Duration { get; set; }
    public Guid CategoryId { get; set; }
}