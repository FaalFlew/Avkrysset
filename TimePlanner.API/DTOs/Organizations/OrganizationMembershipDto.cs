namespace TimePlanner.API.DTOs.Organizations;

public class OrganizationMembershipDto
{
    public Guid MembershipId { get; set; }
    public Guid OrganizationId { get; set; }
    public string OrganizationName { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    public string UserEmail { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty; // display name, or the email when none is set
    public string Role { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? StatusMessage { get; set; }
}
