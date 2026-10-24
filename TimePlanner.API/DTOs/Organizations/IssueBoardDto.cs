namespace TimePlanner.API.DTOs.Organizations;

// This is the top-level response object for the entire board.
public class IssueBoardDto
{
    public Guid OrganizationId { get; set; }
    public string OrganizationName { get; set; } = string.Empty;
    public List<IssuePanelWithIssuesDto> Panels { get; set; } = new();
}