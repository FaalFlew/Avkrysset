using TimePlanner.API.Models.Common;

namespace TimePlanner.API.Models.Organization;

public class OrganizationMembership : AuditableEntity
{
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    public Guid OrganizationId { get; set; }
    public Organization Organization { get; set; } = null!;

    // Role within this specific organization
    public string Role { get; set; } = OrganizationRoles.Member;

    // Status of the membership
    public string Status { get; set; } = MembershipStatus.Active;

    // --- ADD THIS NEW PROPERTY ---
    public string? StatusMessage { get; set; }
}