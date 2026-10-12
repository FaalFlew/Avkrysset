using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Commands.Tasks;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;
using TimePlanner.API.DTOs; // Add this


namespace TimePlanner.API.Features.Commands.Organizations;

public record UpdateOrganizationTaskCommand(
    Guid OrganizationId,
    Guid TaskId,
    string Title,
    DateTime Start,
    double Duration,
    Guid CategoryId) : IRequest;

public class UpdateOrganizationTaskCommandValidator : AbstractValidator<UpdateOrganizationTaskCommand>
{
    public UpdateOrganizationTaskCommandValidator()
    {
        RuleFor(x => x.OrganizationId).NotEmpty().WithMessage("Organization is required.");
        RuleFor(x => x.TaskId).NotEmpty().WithMessage("Task id is required.");
        RuleFor(x => x.Title).NotEmpty().WithMessage(TaskRules.TitleRequired); // no length limit: Tasks.Title is nvarchar(max)
        RuleFor(x => x.Start).NotEmpty().WithMessage(TaskRules.StartRequired);
        RuleFor(x => x.Duration)
            .GreaterThan(0).WithMessage(TaskRules.DurationMustBePositive)
            .LessThanOrEqualTo(TaskRules.MaxDurationHours).WithMessage(TaskRules.DurationTooLong);
        RuleFor(x => x.CategoryId).NotEmpty().WithMessage(TaskRules.CategoryRequired);
    }
}

public class UpdateOrganizationTaskCommandHandler : IRequestHandler<UpdateOrganizationTaskCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // Add this


    public UpdateOrganizationTaskCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // Add this

    }

    public async Task Handle(UpdateOrganizationTaskCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        var membership = await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);

        var task = await _context.Tasks
            .FirstOrDefaultAsync(t => t.Id == request.TaskId && t.OrganizationId == request.OrganizationId, cancellationToken);

        if (task == null)
        {
            throw new KeyNotFoundException("Task not found in this organization.");
        }

        // Authorization: Admins/Owners, or the member who created the task (for themselves).
        // A member who was only assigned the task can't change it.
        if (!TaskCapabilities.For(task.OrganizationId, task.UserId, currentUserId.Value, membership.Role).CanEdit)
        {
            throw new ForbiddenException("Only an organization admin or the task's creator can edit this task.");
        }

        // Categories are personal. Keeping the task's current category (which may belong to whoever created
        // the task) is always allowed; choosing a different one requires one of the editor's own categories.
        if (request.CategoryId != task.CategoryId)
        {
            var categoryExists = await _context.Categories.AnyAsync(c => c.Id == request.CategoryId && c.UserId == currentUserId, cancellationToken);
            if (!categoryExists)
            {
                throw new ValidationException("The specified category was not found for your user.");
            }
        }

        // Organization tasks are not checked against assignees' personal calendars: an admin can't see
        // those, and the assignee's own planner blocks personal tasks that overlap assigned work.

        task.Title = request.Title;
        task.Start = request.Start;
        task.Duration = request.Duration;
        task.CategoryId = request.CategoryId;
        // Note: The UpdatedOnUtc/UpdatedByUserId will be set by the DbContext's SaveChangesAsync override.

        await _context.SaveChangesAsync(cancellationToken);

        // One query for the notification payload (capabilities are per viewer, so none are sent).
        var updatedTaskDto = await TaskProjections.LoadAsync(_context, task.Id, cancellationToken);

        await _notificationService.TaskUpdated(request.OrganizationId, updatedTaskDto);
    }
}