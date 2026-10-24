using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>
/// The member directory, by display name. Owners and Admins see every membership (Active, Left, Removed);
/// members see the active members only.
/// </summary>
public record GetOrganizationMembersQuery(Guid OrganizationId) : IRequest<List<OrganizationMembershipDto>>;

public class GetOrganizationMembersQueryHandler : IRequestHandler<GetOrganizationMembersQuery, List<OrganizationMembershipDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetOrganizationMembersQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<OrganizationMembershipDto>> Handle(GetOrganizationMembersQuery request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null)
        {
            throw new UnauthorizedAccessException();
        }

        // Any active member can read the directory; former members are listed for Owners and Admins only.
        var membership = await _context.RequireActiveMember(userId.Value, request.OrganizationId, cancellationToken);
        var includeFormer = AuthorizationExtensions.IsAdminOrOwnerRole(membership.Role);

        return await _context.OrganizationMemberships
            .AsNoTracking()
            .Where(m => m.OrganizationId == request.OrganizationId)
            .Where(m => includeFormer || m.Status == MembershipStatus.Active)
            .OrderBy(m => m.User.DisplayName ?? m.User.Email)
            .ThenBy(m => m.UserId)
            .Select(MembershipProjections.ToDto)
            .ToListAsync(cancellationToken);
    }
}
