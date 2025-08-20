using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Api.Data;
using Api.Services;

namespace Api.Features.Commands.TaskTemplates;

public record UpdateTaskTemplateCommand(Guid Id, string Title, double Duration, Guid CategoryId) : IRequest;

public class UpdateTaskTemplateCommandValidator : AbstractValidator<UpdateTaskTemplateCommand>
{
    public UpdateTaskTemplateCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Duration).GreaterThan(0);
        RuleFor(x => x.CategoryId).NotEmpty();
    }
}

public class UpdateTaskTemplateCommandHandler : IRequestHandler<UpdateTaskTemplateCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public UpdateTaskTemplateCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task Handle(UpdateTaskTemplateCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        var categoryExists = await _context.Categories
            .AnyAsync(c => c.Id == request.CategoryId && c.UserId == userId, cancellationToken);
        if (!categoryExists)
        {
            throw new ValidationException($"Category with ID {request.CategoryId} not found for this user.");
        }

        var template = await _context.TaskTemplates
            .FirstOrDefaultAsync(tt => tt.Id == request.Id && tt.UserId == userId, cancellationToken);

        if (template == null)
        {
            throw new KeyNotFoundException($"Task Template with ID {request.Id} not found.");
        }

        template.Title = request.Title;
        template.Duration = request.Duration;
        template.CategoryId = request.CategoryId;

        await _context.SaveChangesAsync(cancellationToken);
    }
}