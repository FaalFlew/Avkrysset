using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Api.Data;
using Api.DTOs;
using Api.Models;
using Api.Services;

namespace Api.Features.Commands.Tasks;

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
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
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

        var category = await _context.Categories
            .FirstOrDefaultAsync(c => c.Id == request.CategoryId && c.UserId == userId, cancellationToken);
        if (category == null)
        {
            throw new ValidationException($"Category with ID {request.CategoryId} not found for this user.");
        }

        var newEnd = request.Start.AddHours(request.Duration);
        var isOverlapping = await _context.Tasks
            .Where(t => t.UserId == userId)
            .AnyAsync(t => (request.Start < t.Start.AddHours(t.Duration)) && (t.Start < newEnd), cancellationToken);

        if (isOverlapping)
        {
            throw new InvalidOperationException("This time slot overlaps with an existing task.");
        }

        var task = new TaskItem
        {
            Title = request.Title,
            Start = request.Start,
            Duration = request.Duration,
            CategoryId = request.CategoryId,
            TemplateId = request.TemplateId,
            UserId = userId.Value,
            Category = category,
            CreatedByUserId = userId.Value,
            CreatedOnUtc = DateTime.UtcNow,
            IsDeleted = false
        };

        _context.Tasks.Add(task);
        await _context.SaveChangesAsync(cancellationToken);

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