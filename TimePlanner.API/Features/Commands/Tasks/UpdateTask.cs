using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Tasks;

public record UpdateTaskCommand(
    Guid Id,
    string Title,
    DateTime Start,
    double Duration,
    Guid CategoryId,
    Guid? TemplateId) : IRequest;

public class UpdateTaskCommandValidator : AbstractValidator<UpdateTaskCommand>
{
    public UpdateTaskCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty().WithMessage("Task id is required.");
        RuleFor(x => x.Title).NotEmpty().WithMessage(TaskRules.TitleRequired); // no length limit (Tasks.Title is nvarchar(max))
        RuleFor(x => x.Start).NotEmpty().WithMessage(TaskRules.StartRequired);
        RuleFor(x => x.Duration)
            .GreaterThan(0).WithMessage(TaskRules.DurationMustBePositive)
            .LessThanOrEqualTo(TaskRules.MaxDurationHours).WithMessage(TaskRules.DurationTooLong);
        RuleFor(x => x.CategoryId).NotEmpty().WithMessage(TaskRules.CategoryRequired);
    }
}

public class UpdateTaskCommandHandler : IRequestHandler<UpdateTaskCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public UpdateTaskCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task Handle(UpdateTaskCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        // 1. Retrieve the existing task and ensure ownership. Only personal tasks: organization tasks are
        // changed through the organization endpoints, which apply the organization's rules.
        var task = await _context.Tasks
            .FirstOrDefaultAsync(t => t.Id == request.Id && t.UserId == userId && t.OrganizationId == null, cancellationToken);

        if (task == null)
        {
            throw new KeyNotFoundException($"Task with ID {request.Id} not found.");
        }

        // 2. Validate Category Ownership
        var categoryExists = await _context.Categories
            .AnyAsync(c => c.Id == request.CategoryId && c.UserId == userId, cancellationToken);
        if (!categoryExists)
        {
            throw new ValidationException($"Category with ID {request.CategoryId} not found for this user.");
        }

        // 3. Business Rule: Overlap Check against the user's planner (excluding the task being updated)
        var newEnd = TaskOverlap.EndOf(request.Start, request.Duration);
        await TaskOverlap.ThrowIfOverlapsAsync(
            _context.Tasks.Where(PlannerScope.ForUser(_context, userId.Value)).Where(t => t.Id != request.Id),
            request.Start, newEnd, "This time slot overlaps with an existing task.", cancellationToken);

        // 4. Update the entity
        task.Title = request.Title;
        task.Start = request.Start;
        task.Duration = request.Duration;
        task.CategoryId = request.CategoryId;
        task.TemplateId = request.TemplateId;

        await _context.SaveChangesAsync(cancellationToken);
    }
}