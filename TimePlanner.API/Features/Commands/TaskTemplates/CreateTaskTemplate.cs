using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Features.Commands.Tasks;
using TimePlanner.API.Models;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.TaskTemplates;

public record CreateTaskTemplateCommand(string Title, double Duration, Guid CategoryId) : IRequest<TaskTemplateDto>;

public class CreateTaskTemplateCommandValidator : AbstractValidator<CreateTaskTemplateCommand>
{
    public CreateTaskTemplateCommandValidator()
    {
        RuleFor(x => x.Title)
            .NotEmpty().WithMessage("Template title is required.")
            .MaximumLength(200).WithMessage("Template title can be at most 200 characters.");
        RuleFor(x => x.Duration)
            .GreaterThan(0).WithMessage(TaskRules.DurationMustBePositive)
            .LessThanOrEqualTo(TaskRules.MaxDurationHours).WithMessage(TaskRules.DurationTooLong);
        RuleFor(x => x.CategoryId).NotEmpty().WithMessage(TaskRules.CategoryRequired);
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

        // Security Check: Ensure the category exists and belongs to the current user.
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

        // Load the category to return its name/color in the DTO
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