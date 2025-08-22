using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Api.Data;
using Api.DTOs;
using Api.Services;

namespace Api.Features.Commands.Tasks;

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
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Start).NotEmpty();
        RuleFor(x => x.Duration).GreaterThan(0);
        RuleFor(x => x.CategoryId).NotEmpty();
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

        var task = await _context.Tasks
            .FirstOrDefaultAsync(t => t.Id == request.Id && t.UserId == userId, cancellationToken);

        if (task == null)
        {
            throw new KeyNotFoundException($"Task with ID {request.Id} not found.");
        }
        var categoryExists = await _context.Categories
            .AnyAsync(c => c.Id == request.CategoryId && c.UserId == userId, cancellationToken);
        if (!categoryExists)
        {
            throw new ValidationException($"Category with ID {request.CategoryId} not found for this user.");
        }

        var newEnd = request.Start.AddHours(request.Duration);
        var isOverlapping = await _context.Tasks
            .Where(t => t.UserId == userId && t.Id != request.Id)
            .AnyAsync(t => (request.Start < t.Start.AddHours(t.Duration)) && (t.Start < newEnd), cancellationToken);

        if (isOverlapping)
        {
            throw new InvalidOperationException("This time slot overlaps with an existing task.");
        }

        task.Title = request.Title;
        task.Start = request.Start;
        task.Duration = request.Duration;
        task.CategoryId = request.CategoryId;
        task.TemplateId = request.TemplateId;

        await _context.SaveChangesAsync(cancellationToken);
    }
}