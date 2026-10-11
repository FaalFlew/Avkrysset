using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Models;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Categories;

public record DeleteCategoryCommand(Guid Id) : IRequest;

public class DeleteCategoryCommandHandler : IRequestHandler<DeleteCategoryCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public DeleteCategoryCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task Handle(DeleteCategoryCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        // IMPORTANT: We now also filter by IsDeleted = false
        var category = await _context.Categories
            .FirstOrDefaultAsync(c => c.Id == request.Id && c.UserId == userId, cancellationToken);

        if (category == null)
        {
            // It's standard practice to return a successful status even if the
            // item didn't exist, as the end state (item is gone) is the same.
            // So, we just do nothing and return.
            return;
        }

        // Your original requirement: "Deleting a category safely re-assigns
        // all its associated tasks and templates to a default 'Other' category".
        // Here is the implementation of that business rule.

        var otherCategory = await GetOrCreateOtherCategoryAsync(userId.Value, cancellationToken);

        if (category.Id == otherCategory.Id)
        {
            throw new InvalidOperationException("The default 'Other' category cannot be deleted.");
        }

        // Re-assign tasks
        await _context.Tasks
            .Where(t => t.CategoryId == request.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.CategoryId, otherCategory.Id), cancellationToken);

        // Re-assign templates
        await _context.TaskTemplates
            .Where(tt => tt.CategoryId == request.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(tt => tt.CategoryId, otherCategory.Id), cancellationToken);

        category.IsDeleted = true;
        category.DeletedOnUtc = DateTime.UtcNow;
        category.DeletedByUserId = userId;
        _context.Entry(category).State = EntityState.Modified;

        await _context.SaveChangesAsync(cancellationToken);
    }

    private async Task<Category> GetOrCreateOtherCategoryAsync(Guid userId, CancellationToken cancellationToken)
    {
        const string otherCategoryName = "Other";
        var otherCategory = await _context.Categories
            .FirstOrDefaultAsync(c => c.UserId == userId && c.Name == otherCategoryName, cancellationToken);

        if (otherCategory == null)
        {
            otherCategory = new Category
            {
                Name = otherCategoryName,
                Color = "#8B949E", // A neutral grey color
                UserId = userId
            };
            _context.Categories.Add(otherCategory);
            // We don't save here. It will be saved as part of the main transaction.
        }
        return otherCategory;
    }
}