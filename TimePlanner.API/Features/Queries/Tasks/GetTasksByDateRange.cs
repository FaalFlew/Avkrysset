using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Queries.Tasks;

// We request tasks starting from a certain date and time.
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

        // Query for tasks that fall within the requested range
        var query = _context.Tasks
            .AsNoTracking()
            .Where(t => t.UserId == userId &&
                        t.Start >= request.StartDate &&
                        t.Start < request.EndDate.AddDays(1)) // Ensure we include the entire end day

            .Include(t => t.Category); // Eagerly load the related Category

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