using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Features.Queries.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Queries.Users;

/// <summary>The signed-in user's inbox: pending, unexpired invitations to their email, newest first.</summary>
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
        var currentUser = await _context.Users.FindAsync(new object?[] { _currentUserService.UserId }, cancellationToken);
        if (currentUser == null) throw new UnauthorizedAccessException();

        var now = DateTime.UtcNow;
        return await _context.OrganizationInvitations
            .AsNoTracking()
            .Where(i => i.InvitedUserEmail == currentUser.Email && i.Status == InvitationStatus.Pending && i.ExpiryUtc > now)
            .OrderByDescending(i => i.CreatedOnUtc)
            .ThenBy(i => i.Id)
            .Select(InvitationProjections.ToDto(now))
            .ToListAsync(cancellationToken);
    }
}
