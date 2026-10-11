using TimePlanner.API.Models.Common;

namespace TimePlanner.API.Models.Organization;

public class OrganizationInvitation : AuditableEntity
{
    public Guid OrganizationId { get; set; }
    public Organization Organization { get; set; } = null!;

    // The user who sent the invitation
    public Guid InviterId { get; set; }
    public User Inviter { get; set; } = null!;

    public string InvitedUserEmail { get; set; } = string.Empty;

    // The role the user will be granted upon accepting
    public string Role { get; set; } = OrganizationRoles.Member;

    public string Status { get; set; } = InvitationStatus.Pending;

    // A unique, secure token for the invitation link
    public string Token { get; set; } = string.Empty;

    public DateTime ExpiryUtc { get; set; }
}