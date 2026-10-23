using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

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
        var isMember = await _context.OrganizationMemberships
            .AnyAsync(m => m.OrganizationId == request.OrganizationId &&
                           m.UserId == currentUserId &&
                           m.Status == MembershipStatus.Active,
                      cancellationToken);

        if (!isMember)
        {
            throw new UnauthorizedAccessException("You are not an active member of this organization.");
        }

        var issues = await _context.Issues
            .AsNoTracking()
            .Include(i => i.Category) // Eagerly load Category to get its name
            .Where(i => i.IssuePanelId == request.PanelId && i.OrganizationId == request.OrganizationId)
            // Filter out issues that have already been converted to tasks
            .Where(i => i.ConvertedToTaskItemId == null)
            .Select(i => new IssueDto
            {
                Id = i.Id,
                Title = i.Title,
                Notes = i.Notes,
                CategoryId = i.CategoryId,
                CategoryName = i.Category.Name,
                OrganizationId = i.OrganizationId,
                IssuePanelId = i.IssuePanelId
            })
            // You might want an OrderBy clause here as well
            .ToListAsync(cancellationToken);

        return issues;
    }
}