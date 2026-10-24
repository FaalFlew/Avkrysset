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

        // The user's planner: personal tasks + organization tasks assigned to them (active memberships only),
        // starting in the half-open range [StartDate, EndDate) of UTC instants.
        var tasks = await _context.Tasks
            .AsNoTracking()
            .Where(PlannerScope.ForUser(_context, userId.Value))
            .Where(t => t.Start >= request.StartDate && t.Start < request.EndDate)
            .Select(TaskProjections.ToDto)
            .ToListAsync(cancellationToken);

        var roles = await TaskProjections.ActiveRolesAsync(_context, userId.Value, cancellationToken);
        TaskProjections.ApplyCapabilities(tasks, userId.Value, roles);
        return tasks;
    }
}