using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Models;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Tasks;

public record CreateTaskCommand(
    string Title,
    DateTime Start,
    double Duration,
    Guid CategoryId,
    Guid? TemplateId) : IRequest<TaskItemDto>;

public class CreateTaskCommandValidator : AbstractValidator<CreateTaskCommand>
{
    public CreateTaskCommandValidator()
    {
        RuleFor(x => x.Title).NotEmpty().WithMessage(TaskRules.TitleRequired); // no length limit (Tasks.Title is nvarchar(max))
        RuleFor(x => x.Start).NotEmpty().WithMessage(TaskRules.StartRequired);
        RuleFor(x => x.Duration)
            .GreaterThan(0).WithMessage(TaskRules.DurationMustBePositive)
            .LessThanOrEqualTo(TaskRules.MaxDurationHours).WithMessage(TaskRules.DurationTooLong);
        RuleFor(x => x.CategoryId).NotEmpty().WithMessage(TaskRules.CategoryRequired);
    }
}

public class CreateTaskCommandHandler : IRequestHandler<CreateTaskCommand, TaskItemDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public CreateTaskCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<TaskItemDto> Handle(CreateTaskCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        // 1. Security Check: Validate Category Ownership
        var category = await _context.Categories
            .FirstOrDefaultAsync(c => c.Id == request.CategoryId && c.UserId == userId, cancellationToken);
        if (category == null)
        {
            throw new ValidationException($"Category with ID {request.CategoryId} not found for this user.");
        }

        // 2. Business Rule: Overlap Check against everything in the user's planner
        // (personal tasks and organization tasks assigned to them).
        var newEnd = TaskOverlap.EndOf(request.Start, request.Duration);
        await TaskOverlap.ThrowIfOverlapsAsync(
            _context.Tasks.Where(PlannerScope.ForUser(_context, userId.Value)),
            request.Start, newEnd, "This time slot overlaps with an existing task.", cancellationToken);

        // 3. Create and Save Task
        var task = new TaskItem
        {
            Title = request.Title,
            Start = request.Start,
            Duration = request.Duration,
            CategoryId = request.CategoryId,
            TemplateId = request.TemplateId,
            UserId = userId.Value,
            Category = category, // Attach the loaded category to the entity
            CreatedByUserId = userId.Value,
            CreatedOnUtc = DateTime.UtcNow,
            IsDeleted = false
        };

        _context.Tasks.Add(task);
        await _context.SaveChangesAsync(cancellationToken);

        // 4. Return DTO
        var dto = await TaskProjections.LoadAsync(_context, task.Id, cancellationToken);
        dto.Capabilities = TaskCapabilities.For(null, userId.Value, userId.Value, null);
        return dto;
    }
}