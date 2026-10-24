using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Queries.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

/// <summary>Withdraws a pending invitation (Owner/Admin). 404 when it isn't one of this organization's, 409 when it isn't pending.</summary>
public record RescindInvitationCommand(Guid OrganizationId, Guid InvitationId) : IRequest;

public class RescindInvitationCommandHandler : IRequestHandler<RescindInvitationCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public RescindInvitationCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task Handle(RescindInvitationCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to manage this organization's invitations.", cancellationToken);

        var invitation = await _context.OrganizationInvitations
            .FirstOrDefaultAsync(i => i.Id == request.InvitationId && i.OrganizationId == request.OrganizationId, cancellationToken)
            ?? throw new KeyNotFoundException(InvitationProjections.NotFoundMessage);

        var status = InvitationProjections.EffectiveStatus(invitation.Status, invitation.ExpiryUtc, DateTime.UtcNow);
        if (status == InvitationStatus.Expired)
        {
            throw new ConflictException(InvitationProjections.ExpiredMessage);
        }

        if (status != InvitationStatus.Pending)
        {
            throw InvitationProjections.AlreadyAnswered(status);
        }

        invitation.Status = InvitationStatus.Rescinded;
        await _context.SaveChangesAsync(cancellationToken);
    }
}
