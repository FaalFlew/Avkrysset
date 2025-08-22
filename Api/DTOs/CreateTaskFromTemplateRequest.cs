namespace Api.DTOs;

public class CreateTaskFromTemplateRequest
{
    public Guid TemplateId { get; set; }
    public DateTime Start { get; set; }
}