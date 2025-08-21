using MediatR;
using Microsoft.EntityFrameworkCore;
using Api.Data;
using Api.DTOs;
using Api.Services;

namespace Api.Features.Queries.Tasks;

public record GetTasksByDateRangeQuery(DateTime StartDate, DateTime EndDate) : IRequest<List<TaskItemDto>>;

public class GetTasksByDateRangeQueryHandler : IRequestHandler<GetTasksByDateRangeQuery, List<TaskItemDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetTasksByDateRangeQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<TaskItemDto>> Handle(GetTasksByDateRangeQuery request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        var query = _context.Tasks
            .AsNoTracking()
            .Where(t => t.UserId == userId &&
                        t.Start >= request.StartDate &&
                        t.Start < request.EndDate.AddDays(1))

            .Include(t => t.Category);

        return await query.Select(t => new TaskItemDto
        {
            Id = t.Id,
            Title = t.Title,
            Start = t.Start,
            Duration = t.Duration,
            CategoryId = t.CategoryId,
            CategoryName = t.Category.Name,
            CategoryColor = t.Category.Color,
            TemplateId = t.TemplateId
        })
        .ToListAsync(cancellationToken);
    }
}