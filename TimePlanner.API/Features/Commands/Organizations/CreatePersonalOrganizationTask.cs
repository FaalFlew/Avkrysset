using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

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
        RuleFor(x => x.OrganizationId).NotEmpty();
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Start).NotEmpty();
        RuleFor(x => x.Duration).GreaterThan(0);
        RuleFor(x => x.CategoryId).NotEmpty();
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
        var membership = await _context.OrganizationMemberships
            .Include(m => m.User) // Include user to get the email later
            .FirstOrDefaultAsync(m => m.OrganizationId == request.OrganizationId && m.UserId == currentUserId, cancellationToken);

        if (membership == null || membership.Status != MembershipStatus.Active)
        {
            throw new UnauthorizedAccessException("You are not an active member of this organization.");
        }

        // 2. The category must exist and belong to the current user.
        var category = await _context.Categories
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == request.CategoryId && c.UserId == currentUserId, cancellationToken);
        if (category == null)
        {
            throw new ValidationException($"Category with ID {request.CategoryId} not found for your user.");
        }

        // TODO: Overlap check for the current user's schedule. This can be added later.

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

            // 3. Map to DTO
            var assigneeDto = new TaskAssigneeDto
            {
                UserId = currentUserId.Value,
                UserEmail = membership.User.Email! // We loaded the user in the membership check
            };


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
                Assignees = new List<TaskAssigneeDto> { assigneeDto }
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