using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Queries.Organizations;

public record GetIssueBoardQuery(Guid OrganizationId) : IRequest<IssueBoardDto>;

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
        var membership = await _context.OrganizationMemberships
            .AsNoTracking()
            .FirstOrDefaultAsync(m => m.OrganizationId == request.OrganizationId && m.UserId == currentUserId, cancellationToken);

        if (membership == null || membership.Status != MembershipStatus.Active)
        {
            throw new UnauthorizedAccessException("You are not an active member of this organization.");
        }

        // Fetch the organization name
        var organizationName = await _context.Organizations
            .Where(o => o.Id == request.OrganizationId)
            .Select(o => o.Name)
            .SingleAsync(cancellationToken);

        // This is the core query. We fetch all panels for the organization.
        // For each panel, we include its issues, but only those that have not been converted.
        var panels = await _context.IssuePanels
            .AsNoTracking()
            .Where(p => p.OrganizationId == request.OrganizationId)
            .Select(p => new IssuePanelWithIssuesDto
            {
                Id = p.Id,
                Name = p.Name,
                Issues = p.Issues
                    .Where(i => i.ConvertedToTaskItemId == null) // Filter out converted issues
                    .OrderBy(i => i.CreatedOnUtc) // Example ordering
                    .Select(i => new IssueDto
                    {
                        Id = i.Id,
                        Title = i.Title,
                        Notes = i.Notes,
                        CategoryId = i.CategoryId,
                        CategoryName = i.Category.Name,
                        OrganizationId = i.OrganizationId,
                        IssuePanelId = i.IssuePanelId
                    }).ToList()
            })
            // You could add an OrderBy for the panels themselves here if needed
            .ToListAsync(cancellationToken);

        return new IssueBoardDto
        {
            OrganizationId = request.OrganizationId,
            OrganizationName = organizationName,
            Panels = panels
        };
    }
}