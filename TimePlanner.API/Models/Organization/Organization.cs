using System.ComponentModel.DataAnnotations;
using TimePlanner.API.Models.Common;

namespace TimePlanner.API.Models.Organization;

public class Organization : AuditableEntity
{
    [Required]
    [MaxLength(150)]
    public string Name { get; set; } = string.Empty;

    public Guid OwnerId { get; set; }
    public User Owner { get; set; } = null!;

    [Required]
    [MaxLength(8)] // Short, easy-to-type codes
    public string MemberJoinCode { get; set; } = string.Empty;
    public DateTime MemberJoinCodeExpiryUtc { get; set; }

    [Required]
    [MaxLength(8)]
    public string AdminJoinCode { get; set; } = string.Empty;
    public DateTime AdminJoinCodeExpiryUtc { get; set; }

    // Navigation Properties
    public ICollection<OrganizationMembership> Memberships { get; set; } = new List<OrganizationMembership>();
    public ICollection<IssuePanel> IssuePanels { get; set; } = new List<IssuePanel>();

}