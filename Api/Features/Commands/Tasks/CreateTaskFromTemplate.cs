using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Api.Data;
using Api.DTOs;
using Api.Models;
using Api.Services;

namespace Api.Features.Commands.Tasks;

public record CreateTaskFromTemplateCommand(Guid TemplateId, DateTime Start) : IRequest<TaskItemDto>;

public class CreateTaskFromTemplateCommandValidator : AbstractValidator<CreateTaskFromTemplateCommand>
{
    public CreateTaskFromTemplateCommandValidator()
    {
        RuleFor(x => x.TemplateId).NotEmpty();
        RuleFor(x => x.Start).NotEmpty();
    }
}

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

        var template = await _context.TaskTemplates
            .Include(t => t.Category)
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == request.TemplateId && t.UserId == userId, cancellationToken);

        if (template == null)
        {
            throw new KeyNotFoundException($"Task Template with ID {request.TemplateId} not found for this user.");
        }

        var newEnd = request.Start.AddHours(template.Duration);
        var isOverlapping = await _context.Tasks
            .Where(t => t.UserId == userId)
            .AnyAsync(t => (request.Start < t.Start.AddHours(t.Duration)) && (t.Start < newEnd), cancellationToken);

        if (isOverlapping)
        {
            throw new InvalidOperationException("The new task created from this template overlaps with an existing task.");
        }

        var newTask = new TaskItem
        {
            Title = template.Title,
            Duration = template.Duration,
            CategoryId = template.CategoryId,
            TemplateId = template.Id,
            Start = request.Start,
            UserId = userId.Value
        };

        _context.Tasks.Add(newTask);
        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Task created from template {TemplateId} for user {UserId}", template.Id, userId);

        return new TaskItemDto
        {
            Id = newTask.Id,
            Title = newTask.Title,
            Start = newTask.Start,
            Duration = newTask.Duration,
            CategoryId = newTask.CategoryId,
            CategoryName = template.Category.Name,
            CategoryColor = template.Category.Color,
            TemplateId = newTask.TemplateId
        };
    }
}