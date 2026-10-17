using System.ComponentModel.DataAnnotations;
using TimePlanner.API.Models.Common;

namespace TimePlanner.API.Models.Organization;

// Represents an unscheduled, unassigned work item in the backlog.
public class Issue : AuditableEntity
{
    [Required]
    [MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    public string? Notes { get; set; }

    // Foreign Keys
    public Guid CategoryId { get; set; }
    public Guid OrganizationId { get; set; }
    public Guid IssuePanelId { get; set; }

    // This can be used later for traceability
    public Guid? ConvertedToTaskItemId { get; set; }

    // Navigation Properties
    public Category Category { get; set; } = null!;
    public Organization Organization { get; set; } = null!;
    public IssuePanel IssuePanel { get; set; } = null!;
}