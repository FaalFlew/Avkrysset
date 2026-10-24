namespace TimePlanner.API.DTOs.Organizations;

public class OrganizationInvitationDto
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string OrganizationName { get; set; } = string.Empty;
    public string InvitedUserEmail { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty; // "Admin" | "Member"

    // "Pending" | "Accepted" | "Declined" | "Rescinded" | "Expired" (a pending invitation past its expiry reads "Expired").
    public string Status { get; set; } = string.Empty;
    public DateTime ExpiryUtc { get; set; }
    public string InvitedByDisplayName { get; set; } = string.Empty; // the inviter's display name, or their email
    public DateTime CreatedOnUtc { get; set; }
}
