namespace TimePlanner.API.DTOs.Organizations;

/// <summary>
/// One page of an organization's activity feed, newest first. Ask for the next page with ?before={NextBefore}; it is
/// null when nothing older exists. A page holds at most `limit` items, except when more than `limit` items share one
/// millisecond (they are never split across pages).
/// The feed is derived from existing data (no event table, decision Q-B), so: deleted tasks and issues vanish from it,
/// only a task's latest update shows, a re-join keeps the first "Joined", and only the latest Left/Removed shows.
/// </summary>
public class ActivityPageDto
{
    public List<ActivityItemDto> Items { get; set; } = new();
    public DateTime? NextBefore { get; set; }
}

public class ActivityItemDto
{
    // Stable across pages and refetches, e.g. "task:{taskId}:created", "member:{membershipId}:left".
    public string Id { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; } // millisecond precision (as on the wire)
    public Guid? ActorUserId { get; set; } // null when unknown (e.g. data written without a signed-in user)
    public string? ActorDisplayName { get; set; } // display name, or the email when none is set
    public string? ActorUserEmail { get; set; }
    public string ActionType { get; set; } = string.Empty; // "Created" | "Updated" | "Joined" | "Left" | "Removed" | "Exported"
    public string EntityType { get; set; } = string.Empty; // "Organization" | "Task" | "Issue" | "Member" | "Report"

    // Task/issue/organization id, the member's user id, or the report's document id.
    public string? EntityId { get; set; }
    public string Description { get; set; } = string.Empty; // English fallback, e.g. "Grace created task 'Deploy'."
}
