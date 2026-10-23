using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Queries.Organizations;

public record GetOrganizationIssuePanelsQuery(Guid OrganizationId) : IRequest<List<IssuePanelDto>>;

public class GetOrganizationIssuePanelsQueryHandler : IRequestHandler<GetOrganizationIssuePanelsQuery, List<IssuePanelDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetOrganizationIssuePanelsQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<IssuePanelDto>> Handle(GetOrganizationIssuePanelsQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Any active member can view the issue panels.
        var isMember = await _context.OrganizationMemberships
            .AnyAsync(m => m.OrganizationId == request.OrganizationId &&
                           m.UserId == currentUserId &&
                           m.Status == MembershipStatus.Active,
                      cancellationToken);

        if (!isMember)
        {
            throw new UnauthorizedAccessException("You are not an active member of this organization.");
        }

        var panels = await _context.IssuePanels
            .AsNoTracking()
            .Where(p => p.OrganizationId == request.OrganizationId)
            .Select(p => new IssuePanelDto
            {
                Id = p.Id,
                Name = p.Name,
                OrganizationId = p.OrganizationId
            })
            // You might want to add an OrderBy clause here, e.g., by creation date or a future "Order" property.
            .ToListAsync(cancellationToken);

        return panels;
    }
}