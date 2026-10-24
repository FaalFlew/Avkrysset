namespace TimePlanner.API.DTOs.Organizations;

public class IssueDto
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Notes { get; set; }
    public Guid CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string CategoryColor { get; set; } = string.Empty;
    public Guid OrganizationId { get; set; }
    public Guid IssuePanelId { get; set; }

    // The task the issue was promoted to; null while it is still on the board.
    public Guid? ConvertedToTaskId { get; set; }
    public DateTime CreatedOnUtc { get; set; }
}
