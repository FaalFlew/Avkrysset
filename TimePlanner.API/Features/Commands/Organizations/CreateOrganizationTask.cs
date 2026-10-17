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

public record CreateOrganizationTaskCommand(
    Guid OrganizationId,
    string Title,
    DateTime Start,
    double Duration,
    Guid CategoryId,
    List<Guid> AssigneeIds) : IRequest<TaskItemDto>;

public class CreateOrganizationTaskCommandValidator : AbstractValidator<CreateOrganizationTaskCommand>
{
    public CreateOrganizationTaskCommandValidator()
    {
        RuleFor(x => x.OrganizationId).NotEmpty().WithMessage("Organization is required.");
        RuleFor(x => x.Title).NotEmpty().WithMessage(TaskRules.TitleRequired); // no length limit: Tasks.Title is nvarchar(max)
        RuleFor(x => x.Start).NotEmpty().WithMessage(TaskRules.StartRequired);
        RuleFor(x => x.Duration)
            .GreaterThan(0).WithMessage(TaskRules.DurationMustBePositive)
            .LessThanOrEqualTo(TaskRules.MaxDurationHours).WithMessage(TaskRules.DurationTooLong);
        RuleFor(x => x.CategoryId).NotEmpty().WithMessage(TaskRules.CategoryRequired);
        RuleFor(x => x.AssigneeIds).NotEmpty().WithMessage("At least one assignee is required.");
    }
}

public class CreateOrganizationTaskCommandHandler : IRequestHandler<CreateOrganizationTaskCommand, TaskItemDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public CreateOrganizationTaskCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task<TaskItemDto> Handle(CreateOrganizationTaskCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Current user must be Admin or Owner.
        var membership = await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to assign tasks in this organization.", cancellationToken);

        // --- Data Validation ---
        // 1. Check if the category belongs to the creator (we'll keep categories personal for now).
        var category = await _context.Categories
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == request.CategoryId && c.UserId == currentUserId, cancellationToken);
        if (category == null)
        {
            throw new ValidationException($"Category with ID {request.CategoryId} not found for your user.");
        }

        // 2. Check if all assignees are valid, active members of the organization.
        var members = await _context.OrganizationMemberships
            .Where(m => m.OrganizationId == request.OrganizationId && request.AssigneeIds.Contains(m.UserId))
            .ToListAsync(cancellationToken);

        if (members.Count != request.AssigneeIds.Count)
        {
            throw new ValidationException("One or more specified assignees are not members of this organization.");
        }

        if (members.Any(m => m.Status != MembershipStatus.Active))
        {
            throw new ValidationException("Cannot assign tasks to members who have left or been removed.");
        }

        // Organization tasks are not checked against assignees' personal calendars (decision Q3): an admin
        // can't see those. Each assignee's planner blocks personal tasks that overlap assigned work instead.

        // The transaction runs inside the context's retrying execution strategy (EnableRetryOnFailure rejects a
        // user-initiated transaction outside of it). Each attempt starts with an empty change tracker;
        // disposing an uncommitted transaction rolls it back.
        var strategy = _context.Database.CreateExecutionStrategy();
        var task = await strategy.ExecuteAsync(async () =>
        {
            _context.ChangeTracker.Clear();
            await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);

            // 1. Create the TaskItem
            var task = new TaskItem
            {
                Title = request.Title,
                Start = request.Start,
                Duration = request.Duration,
                CategoryId = request.CategoryId,
                UserId = currentUserId.Value, // Creator
                OrganizationId = request.OrganizationId
            };
            _context.Tasks.Add(task);
            await _context.SaveChangesAsync(cancellationToken); // Save to get the task.Id

            // 2. Create the assignments
            var assignments = request.AssigneeIds.Select(assigneeId => new TaskAssignment
            {
                TaskItemId = task.Id,
                AssigneeId = assigneeId
            }).ToList();
            _context.TaskAssignments.AddRange(assignments);
            await _context.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return task;
        });

        // 3. Map to DTO (one query)
        var taskDto = await TaskProjections.LoadAsync(_context, task.Id, cancellationToken);

        // Only after the commit, and only once even if the transaction was retried.
        await _notificationService.TaskCreated(request.OrganizationId, taskDto);
        return taskDto.WithCapabilities(
            TaskCapabilities.For(task.OrganizationId, task.UserId, currentUserId.Value, membership.Role));
    }
}