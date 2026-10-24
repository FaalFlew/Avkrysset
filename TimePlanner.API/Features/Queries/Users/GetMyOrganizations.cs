using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Features.Queries.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Queries.Users;

/// <summary>The organizations where the caller's membership is active, by name, each with the caller's role.</summary>
public record GetMyOrganizationsQuery : IRequest<List<OrganizationDto>>;

public class GetMyOrganizationsQueryHandler : IRequestHandler<GetMyOrganizationsQuery, List<OrganizationDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetMyOrganizationsQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<OrganizationDto>> Handle(GetMyOrganizationsQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        var memberships = await _context.OrganizationMemberships
            .AsNoTracking()
            .Where(m => m.UserId == currentUserId && m.Status == MembershipStatus.Active)
            .OrderBy(m => m.Organization.Name)
            .Select(m => new { m.Organization, m.Role })
            .ToListAsync(cancellationToken);

        // Join codes only for Owners and Admins (decision Q8).
        return memberships.Select(m => OrganizationDtoMapper.For(m.Organization, m.Role)).ToList();
    }
}
