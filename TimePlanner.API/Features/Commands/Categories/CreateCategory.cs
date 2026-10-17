using FluentValidation;
using MediatR;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Models;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Categories;

public record CreateCategoryCommand(string Name, string Color) : IRequest<CategoryDto>;

public class CreateCategoryCommandValidator : AbstractValidator<CreateCategoryCommand>
{
    public CreateCategoryCommandValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Category name is required.")
            .MaximumLength(100).WithMessage("Category name can be at most 100 characters.");
        // #RRGGBB only: the column holds 7 characters and the editor normalizes to that form.
        RuleFor(x => x.Color).Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Color is required.")
            .Matches("^#[0-9A-Fa-f]{6}$").WithMessage("Color must be a hex color like #2F7FE0.");
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
            UserId = userId.Value,

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