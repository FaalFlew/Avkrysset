using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Api.Data;
using Api.DTOs;
using Api.Models;
using Api.Services;

namespace Api.Features.Commands.TaskTemplates;

public record CreateTaskTemplateCommand(string Title, double Duration, Guid CategoryId) : IRequest<TaskTemplateDto>;

public class CreateTaskTemplateCommandValidator : AbstractValidator<CreateTaskTemplateCommand>
{
    public CreateTaskTemplateCommandValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Duration).GreaterThan(0);
        RuleFor(x => x.CategoryId).NotEmpty();
    }
}

public class CreateTaskTemplateCommandHandler : IRequestHandler<CreateTaskTemplateCommand, TaskTemplateDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public CreateTaskTemplateCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<TaskTemplateDto> Handle(CreateTaskTemplateCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        var categoryExists = await _context.Categories
            .AnyAsync(c => c.Id == request.CategoryId && c.UserId == userId, cancellationToken);
        if (!categoryExists)
        {
            throw new ValidationException($"Category with ID {request.CategoryId} not found for this user.");
        }

        var template = new TaskTemplate
        {
            Title = request.Title,
            Duration = request.Duration,
            CategoryId = request.CategoryId,
            UserId = userId.Value,
        };

        _context.TaskTemplates.Add(template);
        await _context.SaveChangesAsync(cancellationToken);

        await _context.Entry(template).Reference(t => t.Category).LoadAsync(cancellationToken);

        return new TaskTemplateDto
        {
            Id = template.Id,
            Title = template.Title,
            Duration = template.Duration,
            CategoryId = template.CategoryId,
            CategoryName = template.Category.Name,
            CategoryColor = template.Category.Color
        };
    }
}