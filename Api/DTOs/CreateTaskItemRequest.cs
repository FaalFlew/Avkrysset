namespace Api.DTOs;

public class CreateTaskItemRequest
{
    public string Title { get; set; } = string.Empty;
    public DateTime Start { get; set; }
    public double Duration { get; set; }
    public Guid CategoryId { get; set; }
    public Guid? TemplateId { get; set; }
}