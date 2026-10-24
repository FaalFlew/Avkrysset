using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Features.Queries.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Organizations;

/// <summary>
/// Accepts an invitation addressed to the signed-in user's email, by token (email link) or id (inbox).
/// 404 when it doesn't exist or is for someone else, 400 when it expired, 409 when it was already answered.
/// Someone who is already an active member keeps their role: the invitation is just marked Accepted.
/// </summary>
public record AcceptInvitationCommand(InvitationKey Key) : IRequest<OrganizationMembershipDto>;

public class AcceptInvitationCommandHandler : IRequestHandler<AcceptInvitationCommand, OrganizationMembershipDto>
{
    public const string NotYoursMessage = "This invitation is invalid or does not belong to you.";

    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService;

    public AcceptInvitationCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService;
    }

    public async Task<OrganizationMembershipDto> Handle(AcceptInvitationCommand request, CancellationToken cancellationToken)
    {
        var currentUser = await _context.Users.FindAsync(new object?[] { _currentUserService.UserId }, cancellationToken);
        if (currentUser == null) throw new UnauthorizedAccessException();

        var invitation = await request.Key.Filter(_context.OrganizationInvitations)
            .FirstOrDefaultAsync(i => i.InvitedUserEmail == currentUser.Email, cancellationToken)
            ?? throw new KeyNotFoundException(NotYoursMessage);

        await DeclineInvitationCommandHandler.EnsurePendingAsync(_context, invitation, cancellationToken);

        // The transaction runs inside the context's retrying execution strategy (EnableRetryOnFailure rejects a
        // user-initiated transaction outside of it). Each attempt starts with an empty change tracker and
        // re-loads what it changes; disposing an uncommitted transaction rolls it back.
        var strategy = _context.Database.CreateExecutionStrategy();
        var (membershipId, joined) = await strategy.ExecuteAsync(async () =>
        {
            _context.ChangeTracker.Clear();
            await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);

            var pendingInvitation = await _context.OrganizationInvitations
                .SingleAsync(i => i.Id == invitation.Id, cancellationToken);
            if (pendingInvitation.Status != InvitationStatus.Pending)
            {
                throw InvitationProjections.AlreadyAnswered(pendingInvitation.Status); // answered meanwhile
            }

            pendingInvitation.Status = InvitationStatus.Accepted;

            var membership = await _context.OrganizationMemberships
                .FirstOrDefaultAsync(m => m.OrganizationId == invitation.OrganizationId && m.UserId == currentUser.Id, cancellationToken);

            var joined = true;
            if (membership == null)
            {
                membership = new OrganizationMembership
                {
                    OrganizationId = invitation.OrganizationId,
                    UserId = currentUser.Id,
                    Role = invitation.Role,
                    Status = MembershipStatus.Active
                };
                _context.OrganizationMemberships.Add(membership);
            }
            else if (membership.Status == MembershipStatus.Active)
            {
                // Already in (e.g. joined by code meanwhile): never change the role. Overwriting it would demote an
                // admin, or turn the owner into a Member while Organizations.OwnerId still points at them.
                joined = false;
            }
            else
            {
                // Left or was removed earlier: back in, with the invited role.
                membership.Status = MembershipStatus.Active;
                membership.Role = invitation.Role;
            }

            await _context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return (membership.Id, joined);
        });

        var membershipDto = await MembershipProjections.LoadAsync(_context, membershipId, cancellationToken);

        // Only after the commit, and only once even if the transaction was retried.
        if (joined)
        {
            await _notificationService.MemberJoined(invitation.OrganizationId, membershipDto);
        }

        return membershipDto;
    }
}
