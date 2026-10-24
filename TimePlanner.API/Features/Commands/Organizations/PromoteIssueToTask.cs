using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Commands.Tasks;
using TimePlanner.API.Features.Queries.Tasks;
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
        RuleFor(x => x.OrganizationId).NotEmpty().WithMessage("Organization is required.");
        RuleFor(x => x.IssueId).NotEmpty().WithMessage("Issue is required.");
        RuleFor(x => x.Start).NotEmpty().WithMessage(TaskRules.StartRequired);
        RuleFor(x => x.Duration)
            .GreaterThan(0).WithMessage(TaskRules.DurationMustBePositive)
            .LessThanOrEqualTo(TaskRules.MaxDurationHours).WithMessage(TaskRules.DurationTooLong);
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
        var membership = await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to schedule issues in this organization.", cancellationToken);

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

        // 3. Validate that all assignees are active members of the organization (a repeated id counts once).
        var assigneeIds = request.AssigneeIds.Distinct().ToList();
        var members = await _context.OrganizationMemberships
            .Where(m => m.OrganizationId == request.OrganizationId && assigneeIds.Contains(m.UserId))
            .ToListAsync(cancellationToken);

        if (members.Count != assigneeIds.Count || members.Any(m => m.Status != MembershipStatus.Active))
        {
            throw new ValidationException("One or more specified assignees are not active members of this organization.");
        }

        // Organization tasks are not checked against assignees' personal calendars (decision Q3).

        // The transaction runs inside the context's retrying execution strategy (EnableRetryOnFailure rejects a
        // user-initiated transaction outside of it). Each attempt starts with an empty change tracker and
        // re-loads the issue it changes; disposing an uncommitted transaction rolls it back.
        var strategy = _context.Database.CreateExecutionStrategy();
        var task = await strategy.ExecuteAsync(async () =>
        {
            _context.ChangeTracker.Clear();
            await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);

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
            var assignments = assigneeIds.Select(assigneeId => new TaskAssignment
            {
                TaskItemId = task.Id,
                AssigneeId = assigneeId
            }).ToList();
            _context.TaskAssignments.AddRange(assignments);

            // 3. Mark the original issue as converted for traceability.
            var issueToConvert = await _context.Issues.SingleAsync(i => i.Id == issue.Id, cancellationToken);
            issueToConvert.ConvertedToTaskItemId = task.Id;

            await _context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return task;
        });

        // 4. Map to DTO for the response (one query).
        var taskDto = await TaskProjections.LoadAsync(_context, task.Id, cancellationToken);

        // Only after the commit, and only once even if the transaction was retried.
        // Send two notifications: one for the new task, one for the removed issue.
        await _notificationService.TaskCreated(request.OrganizationId, taskDto);
        await _notificationService.IssueDeleted(request.OrganizationId, issue.IssuePanelId, request.IssueId);

        return taskDto.WithCapabilities(
            TaskCapabilities.For(task.OrganizationId, task.UserId, currentUserId.Value, membership.Role));
    }
}