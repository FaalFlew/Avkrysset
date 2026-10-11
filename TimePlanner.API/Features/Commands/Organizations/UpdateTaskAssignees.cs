using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;
using TimePlanner.API.DTOs; // Add these
using TimePlanner.API.DTOs.Organizations;

namespace TimePlanner.API.Features.Commands.Organizations;

public record UpdateTaskAssigneesCommand(Guid OrganizationId, Guid TaskId, List<Guid> NewAssigneeIds) : IRequest;

public class UpdateTaskAssigneesCommandHandler : IRequestHandler<UpdateTaskAssigneesCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public UpdateTaskAssigneesCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task Handle(UpdateTaskAssigneesCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Only Admins or Owners can change assignments.
        if (!await _context.IsAdminOrOwner(currentUserId.Value, request.OrganizationId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You do not have permission to change task assignments in this organization.");
        }

        var task = await _context.Tasks
            .Include(t => t.Assignments)
            .FirstOrDefaultAsync(t => t.Id == request.TaskId && t.OrganizationId == request.OrganizationId, cancellationToken);

        if (task == null)
        {
            throw new KeyNotFoundException("Task not found in this organization.");
        }

        // Validate that all new assignees are active members of the organization.
        var members = await _context.OrganizationMemberships
            .Where(m => m.OrganizationId == request.OrganizationId && request.NewAssigneeIds.Contains(m.UserId))
            .ToListAsync(cancellationToken);

        if (members.Count != request.NewAssigneeIds.Count || members.Any(m => m.Status != MembershipStatus.Active))
        {
            throw new ValidationException("One or more specified assignees are not active members of this organization.");
        }

        // --- Synchronization Logic ---
        var currentAssigneeIds = task.Assignments.Select(a => a.AssigneeId).ToList();
        var newAssigneeIds = request.NewAssigneeIds.Distinct().ToList();

        // 1. Find assignments to remove
        var assignmentsToRemove = task.Assignments
            .Where(a => !newAssigneeIds.Contains(a.AssigneeId))
            .ToList();

        // 2. Find assignees to add
        var assigneeIdsToAdd = newAssigneeIds
            .Where(id => !currentAssigneeIds.Contains(id))
            .ToList();

        var newAssignments = assigneeIdsToAdd.Select(id => new TaskAssignment
        {
            TaskItemId = task.Id,
            AssigneeId = id
        }).ToList();

        if (assignmentsToRemove.Any())
        {
            _context.TaskAssignments.RemoveRange(assignmentsToRemove);
        }
        if (newAssignments.Any())
        {
            await _context.TaskAssignments.AddRangeAsync(newAssignments, cancellationToken);
        }

        if (assignmentsToRemove.Any() || newAssignments.Any())
        {
            await _context.SaveChangesAsync(cancellationToken);
            var updatedTask = await _context.Tasks.AsNoTracking()
                .Include(t => t.Category)
                .Include(t => t.Assignments).ThenInclude(a => a.Assignee)
                .Where(t => t.Id == request.TaskId)
                .Select(t => new TaskItemDto
                {
                    Id = task.Id,
                    Title = task.Title,
                    Start = task.Start,
                    Duration = task.Duration,
                    CategoryId = task.CategoryId,
                    CategoryName = _context.Categories.Find(task.CategoryId)!.Name, // A simple way for now
                    CategoryColor = _context.Categories.Find(task.CategoryId)!.Color,
                    OrganizationId = task.OrganizationId,
                    Assignees = task.Assignments.Select(a => new TaskAssigneeDto
                    {
                        UserId = a.AssigneeId,
                        UserEmail = _context.Users.Find(a.AssigneeId)!.Email!
                    }).ToList()
                })
                .SingleAsync(cancellationToken);

            await _notificationService.TaskUpdated(request.OrganizationId, updatedTask);
        }
    }
}