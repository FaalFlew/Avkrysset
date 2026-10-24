namespace TimePlanner.API.DTOs.Organizations;


// This represents a single panel (column) on the board, with its issues included.
public class IssuePanelWithIssuesDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public List<IssueDto> Issues { get; set; } = new();
}