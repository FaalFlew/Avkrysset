using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

public record GetPanelIssuesQuery(Guid OrganizationId, Guid PanelId) : IRequest<List<IssueDto>>;

public class GetPanelIssuesQueryHandler : IRequestHandler<GetPanelIssuesQuery, List<IssueDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetPanelIssuesQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<IssueDto>> Handle(GetPanelIssuesQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Any active member can view issues.
        await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);

        var issues = await _context.Issues
            .AsNoTracking()
            .Where(i => i.IssuePanelId == request.PanelId && i.OrganizationId == request.OrganizationId)
            // Filter out issues that have already been converted to tasks
            .Where(i => i.ConvertedToTaskItemId == null)
            .Select(IssueProjections.ToDto)
            .ToListAsync(cancellationToken);

        return IssueProjections.Ordered(issues);
    }
}