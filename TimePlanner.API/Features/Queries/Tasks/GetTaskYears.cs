using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Tasks;

// Returns the calendar years (in the caller's time zone, null => UTC) that contain at least one task.
public record GetTaskYearsQuery(string? TimeZoneId = null) : IRequest<List<int>>;

public class GetTaskYearsQueryHandler : IRequestHandler<GetTaskYearsQuery, List<int>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<GetTaskYearsQueryHandler> _logger;

    public GetTaskYearsQueryHandler(
        ApplicationDbContext context,
        ICurrentUserService currentUserService,
        ILogger<GetTaskYearsQueryHandler> logger)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
    }

    public async Task<List<int>> Handle(GetTaskYearsQuery request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        var timeZone = TimeZoneResolver.ResolveOrUtc(request.TimeZoneId, _logger);

        // The year must be taken in the caller's zone (a task at 2025-12-31T23:30Z is in 2026 in Oslo),
        // so only the start instants are read and converted here.
        var starts = await _context.Tasks
            .AsNoTracking()
            .Where(PlannerScope.ForUser(_context, userId.Value))
            .Select(t => t.Start)
            .ToListAsync(cancellationToken);

        var years = TaskYears.LocalYears(starts, timeZone);

        // If the user has no tasks at all, ensure the current year is still an option.
        if (years.Count == 0)
        {
            years.Add(TaskAnalyticsBreakdown.ToLocal(DateTime.UtcNow, timeZone).Year);
        }

        return years;
    }
}

public static class TaskYears
{
    /// <summary>Distinct calendar years of the UTC instants in <paramref name="timeZone"/>, newest first.</summary>
    public static List<int> LocalYears(IEnumerable<DateTime> utcInstants, TimeZoneInfo timeZone) =>
        utcInstants
            .Select(instant => TaskAnalyticsBreakdown.ToLocal(instant, timeZone).Year)
            .Distinct()
            .OrderByDescending(year => year)
            .ToList();
}
