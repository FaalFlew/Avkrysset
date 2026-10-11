using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record TransferOwnershipCommand(Guid OrganizationId, Guid NewOwnerUserId) : IRequest;

public class TransferOwnershipCommandHandler : IRequestHandler<TransferOwnershipCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<TransferOwnershipCommandHandler> _logger;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public TransferOwnershipCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        ILogger<TransferOwnershipCommandHandler> logger,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
        _notificationService = notificationService; // INJECT
    }

    public async Task Handle(TransferOwnershipCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Only the current owner can transfer ownership.
        await _context.RequireOwner(currentUserId.Value, request.OrganizationId, "Only the organization owner can transfer ownership.", cancellationToken);

        if (currentUserId == request.NewOwnerUserId)
        {
            throw new BadRequestException("You cannot transfer ownership to yourself.");
        }

        // The transaction runs inside the context's retrying execution strategy (EnableRetryOnFailure rejects a
        // user-initiated transaction outside of it). Each attempt starts with an empty change tracker and loads
        // everything it changes; disposing an uncommitted transaction rolls it back.
        var strategy = _context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            _context.ChangeTracker.Clear();
            await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);

            // 1. Get the organization and both the current and future owner's memberships.
            var organization = await _context.Organizations.FindAsync(new object[] { request.OrganizationId }, cancellationToken);
            var currentOwnerMembership = await _context.OrganizationMemberships.SingleAsync(m => m.OrganizationId == request.OrganizationId && m.UserId == currentUserId, cancellationToken);
            var newOwnerMembership = await _context.OrganizationMemberships.FirstOrDefaultAsync(m => m.OrganizationId == request.OrganizationId && m.UserId == request.NewOwnerUserId, cancellationToken);

            if (organization == null) throw new KeyNotFoundException("Organization not found.");

            // 2. Business Rule: The new owner must be an existing, active Admin.
            if (newOwnerMembership == null || newOwnerMembership.Status != MembershipStatus.Active || newOwnerMembership.Role != OrganizationRoles.Admin)
            {
                throw new BadRequestException("Ownership can only be transferred to an active Admin of the organization.");
            }

            // 3. Perform the swap.
            // a. Update the Organization's OwnerId
            organization.OwnerId = request.NewOwnerUserId;

            // b. Demote the current owner to Admin
            currentOwnerMembership.Role = OrganizationRoles.Admin;

            // c. Promote the new owner to Owner
            newOwnerMembership.Role = OrganizationRoles.Owner;

            await _context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        });

        // Only after the commit, and only once even if the transaction was retried.
        await _notificationService.OwnershipTransferred(request.OrganizationId, request.NewOwnerUserId, currentUserId.Value);
        await _notificationService.MemberRoleUpdated(request.OrganizationId, request.NewOwnerUserId, OrganizationRoles.Owner);
        await _notificationService.MemberRoleUpdated(request.OrganizationId, currentUserId.Value, OrganizationRoles.Admin);

        _logger.LogInformation("Ownership of Organization {OrganizationId} transferred from User {OldOwnerId} to User {NewOwnerId}.",
            request.OrganizationId, currentUserId, request.NewOwnerUserId);
    }
}