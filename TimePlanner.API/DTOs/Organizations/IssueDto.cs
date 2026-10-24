namespace TimePlanner.API.DTOs.Organizations;

public class IssueDto
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Notes { get; set; }
    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public Guid OrganizationId { get; set; }
    public Guid IssuePanelId { get; set; }
}