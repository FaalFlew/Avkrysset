using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record RemoveMemberCommand(Guid OrganizationId, Guid UserId, bool HardDeleteTasks) : IRequest;

public class RemoveMemberCommandHandler : IRequestHandler<RemoveMemberCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT

    public RemoveMemberCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task Handle(RemoveMemberCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization Check: Current user must be Admin or Owner.
        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to remove members from this organization.", cancellationToken);

        var membershipToRemove = await _context.OrganizationMemberships
            .FirstOrDefaultAsync(m => m.OrganizationId == request.OrganizationId && m.UserId == request.UserId, cancellationToken);

        if (membershipToRemove == null)
        {
            // The user isn't a member, so the desired state is achieved. Do nothing.
            return;
        }

        // Business Rule: The Owner cannot be removed.
        if (membershipToRemove.Role == OrganizationRoles.Owner)
        {
            throw new ConflictException("The organization owner cannot be removed. Transfer ownership first.");
        }

        // --- Soft Leave vs. Hard Delete Logic ---

        // This is the "soft leave" part. The membership is marked as removed.
        membershipToRemove.Status = MembershipStatus.Removed;

        if (request.HardDeleteTasks)
        {
            // 1. Find all task assignments for the user being removed within this organization.
            var userAssignments = await _context.TaskAssignments
                .Where(a => a.AssigneeId == request.UserId && a.TaskItem.OrganizationId == request.OrganizationId)
                .Include(a => a.TaskItem)
                .ThenInclude(t => t.Assignments)
                .ToListAsync(cancellationToken);

            var assignmentsToRemove = new List<TaskAssignment>();
            var tasksToDelete = new List<TimePlanner.API.Models.TaskItem>();

            foreach (var assignment in userAssignments)
            {
                // If the user being removed is the ONLY assignee on this task...
                if (assignment.TaskItem.Assignments.Count == 1)
                {
                    // ...then we delete the entire task.
                    tasksToDelete.Add(assignment.TaskItem);
                }
                else
                {
                    // ...otherwise, we only remove this user's assignment from the task.
                    assignmentsToRemove.Add(assignment);
                }
            }

            if (tasksToDelete.Any())
            {
                _context.Tasks.RemoveRange(tasksToDelete);
            }
            if (assignmentsToRemove.Any())
            {
                _context.TaskAssignments.RemoveRange(assignmentsToRemove);
            }
        }

        await _context.SaveChangesAsync(cancellationToken);
        await _notificationService.MemberRemoved(request.OrganizationId, request.UserId);

    }
}