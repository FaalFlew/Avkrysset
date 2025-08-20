using FluentValidation;
using MediatR;
using Api.Data;
using Api.DTOs;
using Api.Models;
using Api.Services;

namespace Api.Features.Categories.Commands;

public record CreateCategoryCommand(string Name, string Color) : IRequest<CategoryDto>;

public class CreateCategoryCommandValidator : AbstractValidator<CreateCategoryCommand>
{
    public CreateCategoryCommandValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Color).NotEmpty().Length(7).Matches("^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$");
    }
}

public class CreateCategoryCommandHandler : IRequestHandler<CreateCategoryCommand, CategoryDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public CreateCategoryCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<CategoryDto> Handle(CreateCategoryCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        var newCategory = new Category
        {
            Name = request.Name,
            Color = request.Color,
            UserId = userId.Value
        };

        _context.Categories.Add(newCategory);
        await _context.SaveChangesAsync(cancellationToken);

        return new CategoryDto
        {
            Id = newCategory.Id,
            Name = newCategory.Name,
            Color = newCategory.Color
        };
    }
}