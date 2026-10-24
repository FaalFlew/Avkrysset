using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>
/// The organization's board for any active member: panels by creation time then name (ordinal), each with its issues
/// oldest first. Issues promoted to a task are left out unless <paramref name="IncludeScheduled"/> (they then carry
/// convertedToTaskId).
/// </summary>
public record GetIssueBoardQuery(Guid OrganizationId, bool IncludeScheduled = false) : IRequest<IssueBoardDto>;

public class GetIssueBoardQueryHandler : IRequestHandler<GetIssueBoardQuery, IssueBoardDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetIssueBoardQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<IssueBoardDto> Handle(GetIssueBoardQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Any active member can view the issue board.
        await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);

        var organizationName = await _context.Organizations
            .Where(o => o.Id == request.OrganizationId)
            .Select(o => o.Name)
            .SingleAsync(cancellationToken);

        var panels = await _context.IssuePanels
            .AsNoTracking()
            .Where(p => p.OrganizationId == request.OrganizationId)
            .Select(p => new { p.Id, p.Name, p.CreatedOnUtc })
            .ToListAsync(cancellationToken);

        var issuesByPanel = (await _context.Issues
                .AsNoTracking()
                .Where(i => i.OrganizationId == request.OrganizationId)
                .Where(i => request.IncludeScheduled || i.ConvertedToTaskItemId == null)
                .Select(IssueProjections.ToDto)
                .ToListAsync(cancellationToken))
            .ToLookup(i => i.IssuePanelId);

        return new IssueBoardDto
        {
            OrganizationId = request.OrganizationId,
            OrganizationName = organizationName,
            Panels = panels
                .OrderBy(p => p.CreatedOnUtc)
                .ThenBy(p => p.Name, StringComparer.Ordinal)
                .ThenBy(p => p.Id.ToString("D"), StringComparer.Ordinal)
                .Select(p => new IssuePanelWithIssuesDto
                {
                    Id = p.Id,
                    Name = p.Name,
                    Issues = IssueProjections.Ordered(issuesByPanel[p.Id])
                })
                .ToList()
        };
    }
}
