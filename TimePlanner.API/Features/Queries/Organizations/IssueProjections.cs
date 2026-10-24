using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>One SQL projection from <see cref="Issue"/> to <see cref="IssueDto"/>, and the board's ordering.</summary>
public static class IssueProjections
{
    public static readonly Expression<Func<Issue, IssueDto>> ToDto = i => new IssueDto
    {
        Id = i.Id,
        Title = i.Title,
        Notes = i.Notes,
        CategoryId = i.CategoryId,
        CategoryName = i.Category.Name,
        CategoryColor = i.Category.Color,
        OrganizationId = i.OrganizationId,
        IssuePanelId = i.IssuePanelId,
        ConvertedToTaskId = i.ConvertedToTaskItemId,
        CreatedOnUtc = i.CreatedOnUtc
    };

    public static Task<IssueDto> LoadAsync(ApplicationDbContext context, Guid issueId, CancellationToken cancellationToken) =>
        context.Issues.AsNoTracking().Where(i => i.Id == issueId).Select(ToDto).SingleAsync(cancellationToken);

    /// <summary>
    /// Issues within a panel: oldest first, ties by the id's lower-case "D" string in ordinal order (what a client
    /// gets with <c>a.id &lt; b.id</c>). Done in memory: SQL Server orders uniqueidentifiers differently.
    /// </summary>
    public static List<IssueDto> Ordered(IEnumerable<IssueDto> issues) =>
        issues
            .OrderBy(i => i.CreatedOnUtc)
            .ThenBy(i => i.Id.ToString("D"), StringComparer.Ordinal)
            .ToList();
}
