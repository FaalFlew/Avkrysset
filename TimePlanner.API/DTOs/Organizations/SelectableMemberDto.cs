namespace TimePlanner.API.DTOs.Organizations;

public class SelectableMemberDto
{
    public Guid UserId { get; set; }
    public string UserEmail { get; set; } = string.Empty;
}