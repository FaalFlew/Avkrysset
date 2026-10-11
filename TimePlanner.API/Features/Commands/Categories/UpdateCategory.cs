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
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.Name).NotEmpty().MaximumLength(100);
        RuleFor(x => x.Color).NotEmpty().Length(7).Matches("^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$");
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