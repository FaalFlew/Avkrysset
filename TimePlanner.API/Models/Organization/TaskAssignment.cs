using TimePlanner.API.Models.Common;

namespace TimePlanner.API.Models.Organization;

public class TaskAssignment : AuditableEntity // Auditing this can be useful
{
    public Guid TaskItemId { get; set; }
    public TaskItem TaskItem { get; set; } = null!;

    public Guid AssigneeId { get; set; } // The ID of the user this task is assigned to
    public User Assignee { get; set; } = null!;
}