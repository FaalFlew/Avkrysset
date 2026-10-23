namespace TimePlanner.API.DTOs;

public class TaskItemDto
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTime Start { get; set; }
    public double Duration { get; set; }
    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string CategoryColor { get; set; } = string.Empty;
    public Guid? TemplateId { get; set; }
    public List<TaskAssigneeDto> Assignees { get; set; } = new();

}