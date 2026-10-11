using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Queries.Users;

public record GetMyOrganizationTasksQuery(DateTime StartDate, DateTime EndDate) : IRequest<List<TaskItemDto>>;

public class GetMyOrganizationTasksQueryHandler : IRequestHandler<GetMyOrganizationTasksQuery, List<TaskItemDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetMyOrganizationTasksQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<TaskItemDto>> Handle(GetMyOrganizationTasksQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // 1. Find all active organizations the user is a member of (with the user's role in each).
        var roles = await TaskProjections.ActiveRolesAsync(_context, currentUserId.Value, cancellationToken);

        if (roles.Count == 0)
        {
            return new List<TaskItemDto>();
        }

        var myOrganizationIds = roles.Keys.ToList();

        // 2. Fetch all tasks within the date range that are assigned to the user
        //    AND belong to one of their active organizations.
        var tasks = await _context.Tasks
            .AsNoTracking()
            .Where(t => t.OrganizationId.HasValue && myOrganizationIds.Contains(t.OrganizationId.Value))
            .Where(t => t.Start >= request.StartDate && t.Start < request.EndDate)
            .Where(t => t.Assignments.Any(a => a.AssigneeId == currentUserId))
            .OrderBy(t => t.Start)
            .Select(TaskProjections.ToDto)
            .ToListAsync(cancellationToken);

        TaskProjections.ApplyCapabilities(tasks, currentUserId.Value, roles);
        return tasks;
    }
}