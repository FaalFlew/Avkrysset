using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Queries.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Organizations;

/// <summary>
/// Declines an invitation. By id (inbox): the signed-in user's email must be the invited one. By token (email link):
/// whoever holds the token. 404 unknown, 400 expired, 409 already answered.
/// </summary>
public record DeclineInvitationCommand(InvitationKey Key) : IRequest;

public class DeclineInvitationCommandHandler : IRequestHandler<DeclineInvitationCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public DeclineInvitationCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task Handle(DeclineInvitationCommand request, CancellationToken cancellationToken)
    {
        var invitations = request.Key.Filter(_context.OrganizationInvitations);
        var notFound = InvitationProjections.NotFoundMessage;

        if (request.Key.Id is not null)
        {
            var userId = _currentUserService.UserId ?? throw new UnauthorizedAccessException();
            var email = await _context.Users.Where(u => u.Id == userId).Select(u => u.Email).SingleOrDefaultAsync(cancellationToken)
                        ?? throw new UnauthorizedAccessException();
            invitations = invitations.Where(i => i.InvitedUserEmail == email);
            notFound = AcceptInvitationCommandHandler.NotYoursMessage;
        }

        var invitation = await invitations.FirstOrDefaultAsync(cancellationToken) ?? throw new KeyNotFoundException(notFound);

        await EnsurePendingAsync(_context, invitation, cancellationToken);

        invitation.Status = InvitationStatus.Declined;
        await _context.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Throws unless the (tracked) invitation can still be answered: 400 when it expired (a pending one is marked
    /// Expired on the way), 409 when it was accepted, declined or rescinded.
    /// </summary>
    public static async Task EnsurePendingAsync(ApplicationDbContext context, OrganizationInvitation invitation, CancellationToken cancellationToken)
    {
        var status = InvitationProjections.EffectiveStatus(invitation.Status, invitation.ExpiryUtc, DateTime.UtcNow);
        if (status == InvitationStatus.Pending)
        {
            return;
        }

        if (status == InvitationStatus.Expired)
        {
            if (invitation.Status == InvitationStatus.Pending)
            {
                invitation.Status = InvitationStatus.Expired;
                await context.SaveChangesAsync(cancellationToken);
            }

            throw new BadRequestException(InvitationProjections.ExpiredMessage);
        }

        throw InvitationProjections.AlreadyAnswered(status);
    }
}
