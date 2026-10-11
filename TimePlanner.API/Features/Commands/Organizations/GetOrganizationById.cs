using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Queries.Organizations;

public record GetOrganizationByIdQuery(Guid OrganizationId) : IRequest<OrganizationDto>;

public class GetOrganizationByIdQueryHandler : IRequestHandler<GetOrganizationByIdQuery, OrganizationDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetOrganizationByIdQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<OrganizationDto> Handle(GetOrganizationByIdQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: User must be an active member to view the organization.
        var isMember = await _context.OrganizationMemberships.AnyAsync(m =>
            m.OrganizationId == request.OrganizationId &&
            m.UserId == currentUserId &&
            m.Status == MembershipStatus.Active,
            cancellationToken);

        if (!isMember)
        {
            throw new UnauthorizedAccessException("You are not an active member of this organization.");
        }

        var organization = await _context.Organizations
            .AsNoTracking()
            .Where(o => o.Id == request.OrganizationId)
            .Select(o => new OrganizationDto
            {
                Id = o.Id,
                Name = o.Name,
                OwnerId = o.OwnerId,
                MemberJoinCode = o.MemberJoinCode,
                MemberJoinCodeExpiryUtc = o.MemberJoinCodeExpiryUtc,
                AdminJoinCode = o.AdminJoinCode,
                AdminJoinCodeExpiryUtc = o.AdminJoinCodeExpiryUtc
            })
            .SingleOrDefaultAsync(cancellationToken);

        if (organization == null)
        {
            throw new KeyNotFoundException("Organization not found.");
        }

        // Security Refinement: Hide join codes if the user is not the owner.
        if (organization.OwnerId != currentUserId)
        {
            organization.MemberJoinCode = "hidden";
            organization.AdminJoinCode = "hidden";
        }

        return organization;
    }
}