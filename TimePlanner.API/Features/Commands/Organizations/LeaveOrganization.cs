using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Organizations;

public record LeaveOrganizationCommand(Guid OrganizationId) : IRequest;

public class LeaveOrganizationCommandHandler : IRequestHandler<LeaveOrganizationCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<LeaveOrganizationCommandHandler> _logger;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public LeaveOrganizationCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        ILogger<LeaveOrganizationCommandHandler> logger,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
        _notificationService = notificationService; // INJECT

    }

    public async Task Handle(LeaveOrganizationCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        var membership = await _context.OrganizationMemberships
            .FirstOrDefaultAsync(m => m.OrganizationId == request.OrganizationId && m.UserId == currentUserId, cancellationToken);

        if (membership == null || membership.Status != MembershipStatus.Active)
        {
            // If the user isn't an active member, there's nothing to do.
            // This is not an error; the desired state (not being an active member) is already true.
            return;
        }

        // Business Rule: The Owner cannot leave the organization. They must transfer ownership first.
        if (membership.Role == OrganizationRoles.Owner)
        {
            throw new InvalidOperationException("The organization owner cannot leave. You must transfer ownership to another member before you can leave.");
        }

        // This is the "soft leave" logic. We preserve the membership record for historical data
        // but mark it as inactive.
        membership.Status = MembershipStatus.Left;

        await _context.SaveChangesAsync(cancellationToken);
        await _notificationService.MemberLeft(request.OrganizationId, currentUserId.Value);

        _logger.LogInformation("User {UserId} has successfully left Organization {OrganizationId}.", currentUserId, request.OrganizationId);
    }
}