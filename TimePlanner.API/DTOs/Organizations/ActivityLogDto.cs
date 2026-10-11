namespace TimePlanner.API.DTOs.Organizations;

public class ActivityLogDto
{
    public DateTime Timestamp { get; set; }
    public Guid ActorUserId { get; set; }
    public string ActorUserEmail { get; set; } = string.Empty;
    public string ActionType { get; set; } = string.Empty; // e.g., "Created", "Updated", "Joined"
    public string EntityType { get; set; } = string.Empty; // e.g., "Task", "Issue", "Member"
    public string Description { get; set; } = string.Empty; // e.g., "John Doe created task 'Deploy to Prod'"
}