using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Categories;

// We use IRequest (and not IRequest<T>) because a successful update
// typically returns a 204 No Content response, which has no body.
public record UpdateCategoryCommand(Guid Id, string Name, string Color) : IRequest;

public class UpdateCategoryCommandValidator : AbstractValidator<UpdateCategoryCommand>
{
    public UpdateCategoryCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty().WithMessage("Category id is required.");
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Category name is required.")
            .MaximumLength(100).WithMessage("Category name can be at most 100 characters.");
        // #RRGGBB only: the column holds 7 characters and the editor normalizes to that form.
        RuleFor(x => x.Color).Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Color is required.")
            .Matches("^#[0-9A-Fa-f]{6}$").WithMessage("Color must be a hex color like #2F7FE0.");
    }
}

public class UpdateCategoryCommandHandler : IRequestHandler<UpdateCategoryCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public UpdateCategoryCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task Handle(UpdateCategoryCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        // Find the category by its ID, but also ensure it belongs to the current user.
        // This is a critical security check to prevent a user from editing someone else's data.
        var category = await _context.Categories
            .FirstOrDefaultAsync(c => c.Id == request.Id && c.UserId == userId, cancellationToken);

        if (category == null)
        {
            // Throw an exception that our middleware will turn into a 404 Not Found.
            throw new KeyNotFoundException($"Category with ID {request.Id} not found.");
        }

        category.Name = request.Name;
        category.Color = request.Color;

        await _context.SaveChangesAsync(cancellationToken);
    }
}