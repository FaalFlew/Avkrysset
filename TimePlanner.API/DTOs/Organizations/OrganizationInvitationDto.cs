namespace TimePlanner.API.DTOs.Organizations;

public class OrganizationInvitationDto
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string OrganizationName { get; set; } = string.Empty;
    public string InvitedUserEmail { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public DateTime ExpiryUtc { get; set; }
}