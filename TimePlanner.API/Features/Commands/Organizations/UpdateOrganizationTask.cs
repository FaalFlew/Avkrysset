using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
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
        RuleFor(x => x.OrganizationId).NotEmpty();
        RuleFor(x => x.TaskId).NotEmpty();
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Start).NotEmpty();
        RuleFor(x => x.Duration).GreaterThan(0);
        RuleFor(x => x.CategoryId).NotEmpty();
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

        var task = await _context.Tasks
            .Include(t => t.Assignments)
            .FirstOrDefaultAsync(t => t.Id == request.TaskId && t.OrganizationId == request.OrganizationId, cancellationToken);

        if (task == null)
        {
            throw new KeyNotFoundException("Task not found in this organization.");
        }

        // Authorization: User must be an Admin/Owner OR an assignee of the task.
        var isAssignee = task.Assignments.Any(a => a.AssigneeId == currentUserId);
        var isAdminOrOwner = await _context.IsAdminOrOwner(currentUserId.Value, request.OrganizationId, cancellationToken);

        if (!isAssignee && !isAdminOrOwner)
        {
            throw new UnauthorizedAccessException("You do not have permission to edit this task.");
        }

        // Validate the category belongs to the current user (the editor)
        var categoryExists = await _context.Categories.AnyAsync(c => c.Id == request.CategoryId && c.UserId == currentUserId, cancellationToken);
        if (!categoryExists)
        {
            throw new ValidationException("The specified category was not found for your user.");
        }

        // TODO: Overlap check for all assignees.

        task.Title = request.Title;
        task.Start = request.Start;
        task.Duration = request.Duration;
        task.CategoryId = request.CategoryId;
        // Note: The UpdatedOnUtc/UpdatedByUserId will be set by the DbContext's SaveChangesAsync override.

        await _context.SaveChangesAsync(cancellationToken);

        var updatedTaskDto = new TaskItemDto
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
        };

        await _notificationService.TaskUpdated(request.OrganizationId, updatedTaskDto);
    }
}