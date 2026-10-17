using System.ComponentModel.DataAnnotations;
using TimePlanner.API.Models.Common; // Add this using
using TimePlanner.API.Models.Organization; // Add this

namespace TimePlanner.API.Models;

public class TaskItem : AuditableEntity // Inherit from AuditableEntity
{
    [Required]
    public string Title { get; set; } = string.Empty;

    // We use DateTime here because it's the native, efficient way to store
    // and query dates in a database, unlike strings.
    public DateTime Start { get; set; }

    // Duration in hours
    public double Duration { get; set; }

    // Foreign Keys
    public Guid CategoryId { get; set; }
    public Guid UserId { get; set; } // This now represents the CREATOR of the task
    public Guid? TemplateId { get; set; } // Nullable, as a task might not be from a template

    public Guid? OrganizationId { get; set; }

    // Navigation Properties
    public Category Category { get; set; } = null!;
    public User User { get; set; } = null!;
    public Organization.Organization? Organization { get; set; } // Can be null for personal tasks

    // --- ADD THIS FOR MANY-TO-MANY ASSIGNMENTS ---
    public ICollection<TaskAssignment> Assignments { get; set; } = new List<TaskAssignment>();

}
