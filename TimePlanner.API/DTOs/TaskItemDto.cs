namespace TimePlanner.API.DTOs;

public class TaskItemDto
{
    public Guid Id { get; set; }
    public Guid? OrganizationId { get; set; } // null for personal tasks
    public string? OrganizationName { get; set; }
    public string Title { get; set; } = string.Empty;
    public DateTime Start { get; set; }
    public double Duration { get; set; }
    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string CategoryColor { get; set; } = string.Empty;
    public Guid? TemplateId { get; set; }
    public List<TaskAssigneeDto> Assignees { get; set; } = new(); // empty for personal tasks
    public TaskCreatorDto CreatedBy { get; set; } = new();

    // What the requesting user may do with this task. Null only in real-time (SignalR) payloads,
    // which go to every member of the organization and therefore can't be specific to one viewer.
    public TaskCapabilitiesDto? Capabilities { get; set; }

    /// <summary>A copy carrying one viewer's capabilities (the original, e.g. a broadcast payload, is unchanged).</summary>
    public TaskItemDto WithCapabilities(TaskCapabilitiesDto? capabilities)
    {
        var copy = (TaskItemDto)MemberwiseClone();
        copy.Capabilities = capabilities;
        return copy;
    }
}

public class TaskCreatorDto
{
    public Guid UserId { get; set; }
    public string DisplayName { get; set; } = string.Empty; // display name, or the email when none is set
}

public class TaskCapabilitiesDto
{
    public bool CanEdit { get; set; }
    public bool CanDelete { get; set; }
    public bool CanReassign { get; set; }
}
