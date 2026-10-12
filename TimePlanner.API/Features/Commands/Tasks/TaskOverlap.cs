using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models;

namespace TimePlanner.API.Features.Commands.Tasks;

/// <summary>
/// Overlap rule for personal tasks: intervals are half-open [Start, Start + Duration), so tasks that
/// only touch do not overlap. Durations are fractional hours; the end is computed in whole seconds on
/// both sides. (DateTime.AddHours in a query is translated to DATEADD(hour, CAST(Duration AS int), ...),
/// which truncated 1.5h to 1h and 0.25h to 0h.)
/// </summary>
public static class TaskOverlap
{
    public static DateTime EndOf(DateTime start, double durationHours) =>
        start.AddSeconds(Math.Round(durationHours * 3600));

    public static Expression<Func<TaskItem, bool>> Overlaps(DateTime start, DateTime end) =>
        t => start < t.Start.AddSeconds(Math.Round(t.Duration * 3600)) && t.Start < end;

    /// <summary>
    /// Throws 409 when any of <paramref name="candidates"/> overlaps [start, end). An overlap with an
    /// organization task assigned to the user is reported by organization name; otherwise
    /// <paramref name="personalOverlapMessage"/> is used.
    /// </summary>
    public static async Task ThrowIfOverlapsAsync(
        IQueryable<TaskItem> candidates,
        DateTime start,
        DateTime end,
        string personalOverlapMessage,
        CancellationToken cancellationToken)
    {
        var conflict = await candidates
            .Where(Overlaps(start, end))
            .OrderByDescending(t => t.OrganizationId != null) // name an assigned organization task first
            .Select(t => new { t.OrganizationId, OrganizationName = t.Organization != null ? t.Organization.Name : null })
            .FirstOrDefaultAsync(cancellationToken);

        if (conflict is null)
        {
            return;
        }

        throw new ConflictException(conflict.OrganizationId is null
            ? personalOverlapMessage
            : $"This time overlaps a task assigned to you in {conflict.OrganizationName}.");
    }
}
