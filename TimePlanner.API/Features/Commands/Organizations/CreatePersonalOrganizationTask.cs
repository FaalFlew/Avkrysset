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

public record CreatePersonalOrganizationTaskCommand(
    Guid OrganizationId,
    string Title,
    DateTime Start,
    double Duration,
    Guid CategoryId) : IRequest<TaskItemDto>;

public class CreatePersonalOrganizationTaskCommandValidator : AbstractValidator<CreatePersonalOrganizationTaskCommand>
{
    public CreatePersonalOrganizationTaskCommandValidator()
    {
        RuleFor(x => x.OrganizationId).NotEmpty().WithMessage("Organization is required.");
        RuleFor(x => x.Title).NotEmpty().WithMessage(TaskRules.TitleRequired); // no length limit: Tasks.Title is nvarchar(max)
        RuleFor(x => x.Start).NotEmpty().WithMessage(TaskRules.StartRequired);
        RuleFor(x => x.Duration)
            .GreaterThan(0).WithMessage(TaskRules.DurationMustBePositive)
            .LessThanOrEqualTo(TaskRules.MaxDurationHours).WithMessage(TaskRules.DurationTooLong);
        RuleFor(x => x.CategoryId).NotEmpty().WithMessage(TaskRules.CategoryRequired);
    }
}

public class CreatePersonalOrganizationTaskCommandHandler : IRequestHandler<CreatePersonalOrganizationTaskCommand, TaskItemDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public CreatePersonalOrganizationTaskCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task<TaskItemDto> Handle(CreatePersonalOrganizationTaskCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // --- Authorization & Validation ---

        // 1. User must be an active member of the organization.
        var membership = await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);

        // 2. The category must exist and belong to the current user.
        var category = await _context.Categories
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == request.CategoryId && c.UserId == currentUserId, cancellationToken);
        if (category == null)
        {
            throw new ValidationException($"Category with ID {request.CategoryId} not found for your user.");
        }

        // Organization tasks are not checked against personal calendars (decision Q3); the planner blocks
        // personal tasks that overlap assigned organization work instead.

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
                UserId = currentUserId.Value, // Creator is the current user
                OrganizationId = request.OrganizationId
            };
            _context.Tasks.Add(task);
            await _context.SaveChangesAsync(cancellationToken); // Save to get the task.Id

            // 2. Create the assignment - only for the current user
            var assignment = new TaskAssignment
            {
                TaskItemId = task.Id,
                AssigneeId = currentUserId.Value
            };
            _context.TaskAssignments.Add(assignment);
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