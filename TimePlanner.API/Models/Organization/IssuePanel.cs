using System.ComponentModel.DataAnnotations;
using TimePlanner.API.Models.Common;

namespace TimePlanner.API.Models.Organization;

// Represents a named board/column in the issue tracker, e.g., "Bugs", "Features", "Backlog".
public class IssuePanel : AuditableEntity
{
    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    public Guid OrganizationId { get; set; }
    public Organization Organization { get; set; } = null!;

    // Navigation Property
    public ICollection<Issue> Issues { get; set; } = new List<Issue>();
}