using MediatR;
using Microsoft.EntityFrameworkCore;
using Api.Data;
using Api.Models;
using Api.Services;

namespace Api.Features.Commands.Categories;

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

        var category = await _context.Categories
            .FirstOrDefaultAsync(c => c.Id == request.Id && c.UserId == userId, cancellationToken);

        if (category == null)
        {
            return;
        }

        var otherCategory = await GetOrCreateOtherCategoryAsync(userId.Value, cancellationToken);

        if (category.Id == otherCategory.Id)
        {
            throw new InvalidOperationException("The default 'Other' category cannot be deleted.");
        }

        await _context.Tasks
            .Where(t => t.CategoryId == request.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.CategoryId, otherCategory.Id), cancellationToken);

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
                Color = "#8B949E",
                UserId = userId
            };
            _context.Categories.Add(otherCategory);
        }
        return otherCategory;
    }
}