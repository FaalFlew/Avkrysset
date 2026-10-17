namespace TimePlanner.API.DTOs.Organizations;

public class SelectableMemberDto
{
    public Guid UserId { get; set; }
    public string UserEmail { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty; // display name, or the email when none is set
}