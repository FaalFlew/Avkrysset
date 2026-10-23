using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Queries.Users;

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

        var organizations = await _context.OrganizationMemberships
            .AsNoTracking()
            .Where(m => m.UserId == currentUserId && m.Status == MembershipStatus.Active)
            .Include(m => m.Organization)
            .Select(m => new OrganizationDto
            {
                // Note: We are returning the full OrganizationDto, including join codes.
                // We will add an authorization check below to hide these from non-owners.
                Id = m.Organization.Id,
                Name = m.Organization.Name,
                OwnerId = m.Organization.OwnerId,
                TimeZoneId = m.Organization.TimeZoneId,
                MemberJoinCode = m.Organization.MemberJoinCode,
                MemberJoinCodeExpiryUtc = m.Organization.MemberJoinCodeExpiryUtc,
                AdminJoinCode = m.Organization.AdminJoinCode,
                AdminJoinCodeExpiryUtc = m.Organization.AdminJoinCodeExpiryUtc,
            })
            .OrderBy(o => o.Name)
            .ToListAsync(cancellationToken);

        // Security Refinement: Non-owners should not see the join codes when listing organizations.
        foreach (var org in organizations)
        {
            if (org.OwnerId != currentUserId)
            {
                org.MemberJoinCode = "hidden";
                org.AdminJoinCode = "hidden";
            }
        }

        return organizations;
    }
}