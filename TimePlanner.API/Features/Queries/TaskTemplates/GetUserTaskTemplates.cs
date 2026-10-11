using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Queries.TaskTemplates;

public record GetUserTaskTemplatesQuery : IRequest<List<TaskTemplateDto>>;

public class GetUserTaskTemplatesQueryHandler : IRequestHandler<GetUserTaskTemplatesQuery, List<TaskTemplateDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetUserTaskTemplatesQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<TaskTemplateDto>> Handle(GetUserTaskTemplatesQuery request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        return await _context.TaskTemplates
            .AsNoTracking()
            .Where(tt => tt.UserId == userId)
            .Include(tt => tt.Category) // Eagerly load the related Category
            .Select(tt => new TaskTemplateDto
            {
                Id = tt.Id,
                Title = tt.Title,
                Duration = tt.Duration,
                CategoryId = tt.CategoryId,
                CategoryName = tt.Category.Name,
                CategoryColor = tt.Category.Color
            })
            .OrderBy(tt => tt.Title)
            .ToListAsync(cancellationToken);
    }
}