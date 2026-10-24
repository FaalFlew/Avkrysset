namespace TimePlanner.API.DTOs.Organizations;

/// <summary>
/// What the email link's landing page shows (GET /api/invitations/{token}, no sign-in needed: the token is the secret).
/// The invitee's address is masked ("m•••@gmail.com").
/// </summary>
public class InvitationPreviewDto
{
    public Guid OrganizationId { get; set; }
    public string OrganizationName { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty; // "Admin" | "Member"
    public string InvitedByDisplayName { get; set; } = string.Empty;
    public string InvitedEmailMasked { get; set; } = string.Empty;

    // "Pending" | "Accepted" | "Declined" | "Rescinded" | "Expired" (a pending invitation past its expiry reads "Expired").
    public string Status { get; set; } = string.Empty;
    public DateTime ExpiryUtc { get; set; }

    // Whether the signed-in caller's email is the invited one; null when the caller is signed out.
    public bool? MatchesCurrentUser { get; set; }
}
