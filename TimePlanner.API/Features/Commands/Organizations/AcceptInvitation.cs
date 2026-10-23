using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Organizations;

public record AcceptInvitationCommand(string Token) : IRequest<OrganizationMembershipDto>;

public class AcceptInvitationCommandHandler : IRequestHandler<AcceptInvitationCommand, OrganizationMembershipDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public AcceptInvitationCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task<OrganizationMembershipDto> Handle(AcceptInvitationCommand request, CancellationToken cancellationToken)
    {
        var currentUser = await _context.Users.FindAsync(_currentUserService.UserId);
        if (currentUser == null) throw new UnauthorizedAccessException();

        var invitation = await _context.OrganizationInvitations
            .Include(i => i.Organization)
            .FirstOrDefaultAsync(i => i.Token == request.Token && i.InvitedUserEmail == currentUser.Email, cancellationToken);

        if (invitation == null)
        {
            throw new KeyNotFoundException("This invitation is invalid or does not belong to you.");
        }
        if (invitation.Status != InvitationStatus.Pending)
        {
            throw new ConflictException($"This invitation has already been {invitation.Status.ToLower()}.");
        }
        if (invitation.ExpiryUtc < DateTime.UtcNow)
        {
            invitation.Status = InvitationStatus.Expired;
            await _context.SaveChangesAsync(cancellationToken);
            throw new BadRequestException("This invitation has expired.");
        }

        var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            // Mark invitation as accepted
            invitation.Status = InvitationStatus.Accepted;

            // Create or reactivate membership
            var membership = await _context.OrganizationMemberships
                .FirstOrDefaultAsync(m => m.OrganizationId == invitation.OrganizationId && m.UserId == currentUser.Id, cancellationToken);

            if (membership != null) // User was previously a member and left/was removed
            {
                membership.Status = MembershipStatus.Active;
                membership.Role = invitation.Role; // Update their role
            }
            else // New member
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

            await _context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            var membershipDto = new OrganizationMembershipDto
            {
                MembershipId = membership.Id,
                OrganizationId = membership.OrganizationId,
                OrganizationName = invitation.Organization.Name,
                UserId = membership.UserId,
                UserEmail = currentUser.Email!,
                Role = membership.Role,
                Status = membership.Status
            };

            await _notificationService.MemberJoined(invitation.OrganizationId, membershipDto);

            return membershipDto;
        }
        catch (Exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }
}