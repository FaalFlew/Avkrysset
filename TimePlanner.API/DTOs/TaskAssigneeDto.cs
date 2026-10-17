namespace TimePlanner.API.DTOs;

public class TaskAssigneeDto
{
    public Guid UserId { get; set; }
    public string DisplayName { get; set; } = string.Empty; // display name, or the email when none is set
    public string Email { get; set; } = string.Empty;
}
