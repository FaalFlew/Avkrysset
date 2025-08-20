using MediatR;
using Microsoft.EntityFrameworkCore;
using Api.Data;
using Api.DTOs;
using Api.Services;

namespace Api.Features.Categories.Queries;

public record GetUserCategoriesQuery : IRequest<List<CategoryDto>>;

public class GetUserCategoriesQueryHandler : IRequestHandler<GetUserCategoriesQuery, List<CategoryDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetUserCategoriesQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<CategoryDto>> Handle(GetUserCategoriesQuery request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null)
        {
            throw new UnauthorizedAccessException();
        }

        return await _context.Categories
            .AsNoTracking()
            .Where(c => c.UserId == userId)
            .Select(c => new CategoryDto
            {
                Id = c.Id,
                Name = c.Name,
                Color = c.Color
            })
            .OrderBy(c => c.Name)
            .ToListAsync(cancellationToken);
    }
}