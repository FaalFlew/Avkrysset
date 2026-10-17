using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

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

        var membership = await _context.OrganizationMemberships
            .AsNoTracking()
            .Include(m => m.User)
            .Include(m => m.Organization)
            .Where(m => m.OrganizationId == request.OrganizationId && m.UserId == currentUserId)
            .Select(m => new OrganizationMembershipDto
            {
                MembershipId = m.Id,
                OrganizationId = m.OrganizationId,
                OrganizationName = m.Organization.Name,
                UserId = m.UserId,
                UserEmail = m.User.Email!,
                DisplayName = m.User.DisplayName ?? m.User.Email!,
                Role = m.Role,
                Status = m.Status,
                StatusMessage = m.StatusMessage
            })
            .SingleOrDefaultAsync(cancellationToken);

        if (membership == null)
        {
            // This is not an access violation, but a "Not Found" case. The user might have been removed.
            throw new KeyNotFoundException(AuthorizationExtensions.OrganizationNotFoundMessage);
        }

        return membership;
    }
}