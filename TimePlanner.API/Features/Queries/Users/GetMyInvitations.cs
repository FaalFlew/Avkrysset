using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Queries.Users;

public record GetMyInvitationsQuery : IRequest<List<OrganizationInvitationDto>>;

public class GetMyInvitationsQueryHandler : IRequestHandler<GetMyInvitationsQuery, List<OrganizationInvitationDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetMyInvitationsQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<OrganizationInvitationDto>> Handle(GetMyInvitationsQuery request, CancellationToken cancellationToken)
    {
        var currentUser = await _context.Users.FindAsync(_currentUserService.UserId);
        if (currentUser == null) throw new UnauthorizedAccessException();

        var invitations = await _context.OrganizationInvitations
            .AsNoTracking()
            .Include(i => i.Organization)
            .Where(i => i.InvitedUserEmail == currentUser.Email && i.Status == InvitationStatus.Pending)
            .Where(i => i.ExpiryUtc > DateTime.UtcNow)
            .Select(i => new OrganizationInvitationDto
            {
                Id = i.Id,
                OrganizationId = i.OrganizationId,
                OrganizationName = i.Organization.Name,
                InvitedUserEmail = i.InvitedUserEmail,
                Role = i.Role,
                Status = i.Status,
                ExpiryUtc = i.ExpiryUtc
            })
            .ToListAsync(cancellationToken);

        return invitations;
    }
}