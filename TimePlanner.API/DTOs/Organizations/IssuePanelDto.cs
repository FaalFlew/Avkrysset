namespace TimePlanner.API.DTOs.Organizations;

public class IssuePanelDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid OrganizationId { get; set; }
}