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
        RuleFor(x => x.OrganizationId).NotEmpty();
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Start).NotEmpty();
        RuleFor(x => x.Duration).GreaterThan(0);
        RuleFor(x => x.CategoryId).NotEmpty();
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
        if (!await _context.IsAdminOrOwner(currentUserId.Value, request.OrganizationId, cancellationToken))
        {
            // Self-assignment for members is handled in a different command.
            throw new UnauthorizedAccessException("You do not have permission to assign tasks in this organization.");
        }

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

        // TODO: Overlap check for all assignees. This is complex and can be a V2 feature.
        // For now, we'll skip it to keep the example manageable.

        var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
        try
        {
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

            // 3. Map to DTO
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
                CategoryName = category.Name,
                CategoryColor = category.Color,
                OrganizationId = task.OrganizationId,
                Assignees = assigneeDtos
            };
            await _notificationService.TaskCreated(request.OrganizationId, taskDto);
            return taskDto;


        }
        catch (Exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }
}