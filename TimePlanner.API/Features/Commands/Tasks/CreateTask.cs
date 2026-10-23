using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
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
        RuleFor(x => x.Title).NotEmpty();
        RuleFor(x => x.Start).NotEmpty();
        RuleFor(x => x.Duration).GreaterThan(0);
        RuleFor(x => x.CategoryId).NotEmpty();
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

        // 2. Business Rule: Overlap Check
        var newEnd = request.Start.AddHours(request.Duration);
        var isOverlapping = await _context.Tasks
            .Where(t => t.UserId == userId)
            // Checks if existing task ends after new task starts AND existing task starts before new task ends
            .AnyAsync(t => (request.Start < t.Start.AddHours(t.Duration)) && (t.Start < newEnd), cancellationToken);

        if (isOverlapping)
        {
            throw new InvalidOperationException("This time slot overlaps with an existing task.");
        }

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
        return new TaskItemDto
        {
            Id = task.Id,
            Title = task.Title,
            Start = task.Start,
            Duration = task.Duration,
            CategoryId = task.CategoryId,
            CategoryName = category.Name,
            CategoryColor = category.Color,
            TemplateId = task.TemplateId
        };
    }
}