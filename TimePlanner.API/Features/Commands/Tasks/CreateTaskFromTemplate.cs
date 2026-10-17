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

//================================================================================
// 1. The Command
//================================================================================
// It carries the necessary data and specifies that it will return a TaskItemDto on success.
public record CreateTaskFromTemplateCommand(Guid TemplateId, DateTime Start) : IRequest<TaskItemDto>;

//================================================================================
// 2. The Validator
//================================================================================
public class CreateTaskFromTemplateCommandValidator : AbstractValidator<CreateTaskFromTemplateCommand>
{
    public CreateTaskFromTemplateCommandValidator()
    {
        RuleFor(x => x.TemplateId).NotEmpty().WithMessage("Template is required.");
        RuleFor(x => x.Start).NotEmpty().WithMessage(TaskRules.StartRequired);
    }
}

//================================================================================
// 3. The Handler
//================================================================================
public class CreateTaskFromTemplateCommandHandler : IRequestHandler<CreateTaskFromTemplateCommand, TaskItemDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<CreateTaskFromTemplateCommandHandler> _logger;

    public CreateTaskFromTemplateCommandHandler(
        ApplicationDbContext context,
        ICurrentUserService currentUserService,
        ILogger<CreateTaskFromTemplateCommandHandler> logger)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
    }

    public async Task<TaskItemDto> Handle(CreateTaskFromTemplateCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        // 1. Find the template and ensure it belongs to the current user.
        // We also Include the Category so we can use its details later.
        var template = await _context.TaskTemplates
            .Include(t => t.Category)
            .AsNoTracking() // It's a read operation, so we don't need to track the template entity.
            .FirstOrDefaultAsync(t => t.Id == request.TemplateId && t.UserId == userId, cancellationToken);

        if (template == null)
        {
            throw new KeyNotFoundException($"Task Template with ID {request.TemplateId} not found for this user.");
        }

        // 2. Business Rule: Overlap Check for the new task.
        // Checked against everything in the user's planner (personal tasks and assigned organization tasks).
        var newEnd = TaskOverlap.EndOf(request.Start, template.Duration);
        await TaskOverlap.ThrowIfOverlapsAsync(
            _context.Tasks.Where(PlannerScope.ForUser(_context, userId.Value)),
            request.Start, newEnd, "The new task created from this template overlaps with an existing task.", cancellationToken);

        // 3. Create the new TaskItem by inheriting properties from the template.
        var newTask = new TaskItem
        {
            Title = template.Title,
            Duration = template.Duration,
            CategoryId = template.CategoryId,
            TemplateId = template.Id, // Link back to the template
            Start = request.Start,    // Use the start time from the request
            UserId = userId.Value
        };

        // 4. Add to context and save.
        _context.Tasks.Add(newTask);
        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Task created from template {TemplateId} for user {UserId}", template.Id, userId);

        // 5. Map to DTO and return.
        var dto = await TaskProjections.LoadAsync(_context, newTask.Id, cancellationToken);
        dto.Capabilities = TaskCapabilities.For(null, userId.Value, userId.Value, null);
        return dto;
    }
}