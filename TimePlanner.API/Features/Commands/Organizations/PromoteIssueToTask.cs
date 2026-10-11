using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record PromoteIssueToTaskCommand(
    Guid OrganizationId,
    Guid IssueId,
    DateTime Start,
    double Duration,
    List<Guid> AssigneeIds) : IRequest<TaskItemDto>;

public class PromoteIssueToTaskCommandValidator : AbstractValidator<PromoteIssueToTaskCommand>
{
    public PromoteIssueToTaskCommandValidator()
    {
        RuleFor(x => x.OrganizationId).NotEmpty();
        RuleFor(x => x.IssueId).NotEmpty();
        RuleFor(x => x.Start).NotEmpty();
        RuleFor(x => x.Duration).GreaterThan(0);
        RuleFor(x => x.AssigneeIds).NotEmpty().WithMessage("At least one assignee is required.");
    }
}

public class PromoteIssueToTaskCommandHandler : IRequestHandler<PromoteIssueToTaskCommand, TaskItemDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public PromoteIssueToTaskCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService;

    }

    public async Task<TaskItemDto> Handle(PromoteIssueToTaskCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Current user must be Admin or Owner.
        if (!await _context.IsAdminOrOwner(currentUserId.Value, request.OrganizationId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You do not have permission to schedule issues in this organization.");
        }

        // --- Data Validation ---
        // 1. Find the original issue.
        var issue = await _context.Issues
            .Include(i => i.Category) // Include category for later use
            .FirstOrDefaultAsync(i => i.Id == request.IssueId && i.OrganizationId == request.OrganizationId, cancellationToken);

        if (issue == null)
        {
            throw new KeyNotFoundException("The specified issue was not found in this organization.");
        }

        // 2. Ensure the issue hasn't already been converted.
        if (issue.ConvertedToTaskItemId.HasValue)
        {
            throw new ConflictException("This issue has already been converted to a task.");
        }

        // 3. Validate that all assignees are active members of the organization.
        var members = await _context.OrganizationMemberships
            .Where(m => m.OrganizationId == request.OrganizationId && request.AssigneeIds.Contains(m.UserId))
            .ToListAsync(cancellationToken);

        if (members.Count != request.AssigneeIds.Count || members.Any(m => m.Status != MembershipStatus.Active))
        {
            throw new ValidationException("One or more specified assignees are not active members of this organization.");
        }

        // TODO: Overlap check for assignees' schedules (optional V2 feature).

        var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            // 1. Create the new TaskItem, copying details from the Issue.
            var task = new TaskItem
            {
                Title = issue.Title,
                Start = request.Start,
                Duration = request.Duration,
                CategoryId = issue.CategoryId,
                UserId = currentUserId.Value, // The user promoting the issue is the creator
                OrganizationId = issue.OrganizationId
            };
            _context.Tasks.Add(task);
            await _context.SaveChangesAsync(cancellationToken);

            // 2. Create the assignments.
            var assignments = request.AssigneeIds.Select(assigneeId => new TaskAssignment
            {
                TaskItemId = task.Id,
                AssigneeId = assigneeId
            }).ToList();
            _context.TaskAssignments.AddRange(assignments);

            // 3. Mark the original issue as converted for traceability.
            issue.ConvertedToTaskItemId = task.Id;
            _context.Issues.Update(issue);

            await _context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            // 4. Map to DTO for the response.
            var assigneeDtos = await _context.Users
                .Where(u => request.AssigneeIds.Contains(u.Id))
                .Select(u => new TaskAssigneeDto { UserId = u.Id, UserEmail = u.Email! })
                .ToListAsync(cancellationToken);

            var taskDto = new TaskItemDto
            {
                Id = task.Id,
                Title = task.Title,
                Start = task.Start,
                Duration = task.Duration,
                CategoryId = task.CategoryId,
                CategoryName = issue.Category.Name, // We loaded the category with the issue
                CategoryColor = issue.Category.Color,
                OrganizationId = task.OrganizationId,
                Assignees = assigneeDtos
            };
            // Send two notifications: one for the new task, one for the removed issue.
            await _notificationService.TaskCreated(request.OrganizationId, taskDto);
            await _notificationService.IssueDeleted(request.OrganizationId, issue.IssuePanelId, request.IssueId);

            return taskDto;
        }
        catch (Exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }
}