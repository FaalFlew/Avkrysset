using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>The caller's membership; 404 "Organization not found." unless it is active.</summary>
public record GetMyMembershipQuery(Guid OrganizationId) : IRequest<OrganizationMembershipDto>;

public class GetMyMembershipQueryHandler : IRequestHandler<GetMyMembershipQuery, OrganizationMembershipDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetMyMembershipQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<OrganizationMembershipDto> Handle(GetMyMembershipQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Members who left or were removed get the same 404 as people who never joined.
        return await _context.OrganizationMemberships
                   .AsNoTracking()
                   .Where(m => m.OrganizationId == request.OrganizationId
                               && m.UserId == currentUserId
                               && m.Status == MembershipStatus.Active)
                   .Select(MembershipProjections.ToDto)
                   .SingleOrDefaultAsync(cancellationToken)
               ?? throw new KeyNotFoundException(AuthorizationExtensions.OrganizationNotFoundMessage);
    }
}
