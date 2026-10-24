using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>
/// The calendar years, in the organization's zone, that contain organization tasks (for a member: tasks assigned to
/// them), newest first; the current year in that zone when there are none. Feeds the analytics year picker.
/// </summary>
public record GetOrganizationYearsQuery(Guid OrganizationId) : IRequest<List<int>>;

public class GetOrganizationYearsQueryHandler : IRequestHandler<GetOrganizationYearsQuery, List<int>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<GetOrganizationYearsQueryHandler> _logger;

    public GetOrganizationYearsQueryHandler(
        ApplicationDbContext context, ICurrentUserService currentUserService, ILogger<GetOrganizationYearsQueryHandler> logger)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
    }

    public async Task<List<int>> Handle(GetOrganizationYearsQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        var membership = await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);
        var me = currentUserId.Value;
        var allTasks = AuthorizationExtensions.IsAdminOrOwnerRole(membership.Role);
        var (_, zone) = await OrganizationAnalytics.ZoneAsync(_context, request.OrganizationId, _logger, cancellationToken);

        // The year must be taken in the organization's zone, so only the start instants are read and converted here.
        var starts = await _context.Tasks
            .AsNoTracking()
            .Where(t => t.OrganizationId == request.OrganizationId)
            .Where(t => allTasks || t.Assignments.Any(a => a.AssigneeId == me))
            .Select(t => t.Start)
            .ToListAsync(cancellationToken);

        var years = TaskYears.LocalYears(starts, zone);
        if (years.Count == 0)
        {
            years.Add(TaskAnalyticsBreakdown.ToLocal(DateTime.UtcNow, zone).Year);
        }

        return years;
    }
}
