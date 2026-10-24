using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>
/// The organization's activity feed for any active member, newest first, in pages: items strictly before
/// <paramref name="Before"/> (default: now), at most <paramref name="Limit"/> (1-100) per page.
/// Derived from existing tables (decision Q-B): the organization, its tasks (created; latest update), memberships
/// (first join; latest Left/Removed), issues (created, including promoted ones) and its report exports.
/// </summary>
public record GetOrganizationActivityQuery(Guid OrganizationId, DateTime? Before = null, int Limit = GetOrganizationActivityQuery.DefaultLimit)
    : IRequest<ActivityPageDto>
{
    public const int DefaultLimit = 50;
    public const int MaxLimit = 100;
}

public class GetOrganizationActivityQueryValidator : AbstractValidator<GetOrganizationActivityQuery>
{
    public GetOrganizationActivityQueryValidator()
    {
        RuleFor(q => q.Limit)
            .InclusiveBetween(1, GetOrganizationActivityQuery.MaxLimit)
            .WithMessage($"limit must be between 1 and {GetOrganizationActivityQuery.MaxLimit}.");
    }
}

public class GetOrganizationActivityQueryHandler : IRequestHandler<GetOrganizationActivityQuery, ActivityPageDto>
{
    private const string Someone = "Someone";

    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetOrganizationActivityQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    /// <summary>An item before its people are looked up. Timestamps are truncated to whole milliseconds (the wire precision).</summary>
    private sealed record RawItem(
        string Id, DateTime Timestamp, Guid? ActorId, string ActionType, string EntityType, string? EntityId,
        string? Title = null, Guid? SubjectId = null, string? Kind = null);

    /// <summary>Who is reading: members see task activity only for tasks assigned to them (decision Q-A).</summary>
    private sealed record Viewer(Guid UserId, bool SeesEverything);

    public async Task<ActivityPageDto> Handle(GetOrganizationActivityQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Any active member can view the activity log.
        // Members who left or were removed no longer see the feed.
        await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);
        var viewer = new Viewer(currentUserId.Value, SeesEverything: true);

        // Exclusive upper bound on a whole millisecond: then "timestamp < before" means the same for the stored value
        // and for the millisecond the client saw.
        var before = CeilToMillisecond(AsUtc(request.Before ?? DateTime.UtcNow));
        var limit = request.Limit;

        var candidates = Sorted(await LoadAsync(request.OrganizationId, viewer, null, before, limit + 1, cancellationToken));

        List<RawItem> page;
        DateTime? nextBefore;
        if (candidates.Count <= limit)
        {
            // Every source returned fewer than limit + 1 items: nothing older exists.
            (page, nextBefore) = (candidates, null);
        }
        else
        {
            // Each page ends between two different milliseconds, so "before = last timestamp" never skips or repeats
            // an item: the millisecond at the boundary moves to the next page when the page can't hold all of it.
            page = candidates.Take(limit).ToList();
            var boundary = candidates[limit].Timestamp;
            if (page[^1].Timestamp == boundary)
            {
                page = page.Where(i => i.Timestamp > boundary).ToList();
                if (page.Count == 0)
                {
                    // More than `limit` items in one millisecond: return all of them (the page exceeds the limit).
                    page = Sorted(await LoadAsync(request.OrganizationId, viewer, boundary, boundary.AddMilliseconds(1), null, cancellationToken));
                }
            }

            nextBefore = page[^1].Timestamp;
        }

        return new ActivityPageDto
        {
            Items = await DescribeAsync(page, cancellationToken),
            NextBefore = nextBefore
        };
    }

    /// <summary>
    /// The items of every source with <paramref name="fromInclusive"/> &lt;= timestamp &lt; <paramref name="before"/>,
    /// each source cut to its newest <paramref name="take"/> items (all when null).
    /// </summary>
    private async Task<List<RawItem>> LoadAsync(
        Guid organizationId, Viewer viewer, DateTime? fromInclusive, DateTime before, int? take, CancellationToken cancellationToken)
    {
        var from = fromInclusive ?? DateTime.MinValue;
        var count = take ?? int.MaxValue;
        var items = new List<RawItem>();

        // Organization created.
        items.AddRange((await _context.Organizations.AsNoTracking()
                .Where(o => o.Id == organizationId && o.CreatedOnUtc >= from && o.CreatedOnUtc < before)
                .Select(o => new { o.Id, o.CreatedOnUtc, o.CreatedByUserId })
                .ToListAsync(cancellationToken))
            .Select(o => new RawItem($"org:{o.Id}:created", Ms(o.CreatedOnUtc), o.CreatedByUserId, "Created", "Organization", o.Id.ToString())));

        // Tasks: created, and their latest update (by whoever made it).
        var tasks = _context.Tasks.AsNoTracking().Where(t => t.OrganizationId == organizationId);
        if (!viewer.SeesEverything)
        {
            tasks = tasks.Where(t => t.Assignments.Any(a => a.AssigneeId == viewer.UserId));
        }

        items.AddRange((await tasks
                .Where(t => t.CreatedOnUtc >= from && t.CreatedOnUtc < before)
                .OrderByDescending(t => t.CreatedOnUtc)
                .Take(count)
                .Select(t => new { t.Id, t.CreatedOnUtc, t.CreatedByUserId, t.Title })
                .ToListAsync(cancellationToken))
            .Select(t => new RawItem($"task:{t.Id}:created", Ms(t.CreatedOnUtc), t.CreatedByUserId, "Created", "Task", t.Id.ToString(), t.Title)));

        items.AddRange((await tasks
                .Where(t => t.UpdatedOnUtc != null && t.UpdatedOnUtc >= from && t.UpdatedOnUtc < before)
                .OrderByDescending(t => t.UpdatedOnUtc)
                .Take(count)
                .Select(t => new { t.Id, UpdatedOnUtc = t.UpdatedOnUtc!.Value, t.UpdatedByUserId, t.Title })
                .ToListAsync(cancellationToken))
            .Select(t => new RawItem($"task:{t.Id}:updated", Ms(t.UpdatedOnUtc), t.UpdatedByUserId, "Updated", "Task", t.Id.ToString(), t.Title)));

        // Memberships: the first join, and the latest Left/Removed.
        var memberships = _context.OrganizationMemberships.AsNoTracking().Where(m => m.OrganizationId == organizationId);

        items.AddRange((await memberships
                .Where(m => m.CreatedOnUtc >= from && m.CreatedOnUtc < before)
                .OrderByDescending(m => m.CreatedOnUtc)
                .Take(count)
                .Select(m => new { m.Id, m.CreatedOnUtc, m.UserId })
                .ToListAsync(cancellationToken))
            .Select(m => new RawItem($"member:{m.Id}:joined", Ms(m.CreatedOnUtc), m.UserId, "Joined", "Member", m.UserId.ToString(), SubjectId: m.UserId)));

        items.AddRange((await memberships
                .Where(m => (m.Status == MembershipStatus.Left || m.Status == MembershipStatus.Removed)
                            && m.UpdatedOnUtc != null && m.UpdatedOnUtc >= from && m.UpdatedOnUtc < before)
                .OrderByDescending(m => m.UpdatedOnUtc)
                .Take(count)
                .Select(m => new { m.Id, UpdatedOnUtc = m.UpdatedOnUtc!.Value, m.UpdatedByUserId, m.UserId, m.Status })
                .ToListAsync(cancellationToken))
            .Select(m =>
            {
                var action = m.Status == MembershipStatus.Left ? "Left" : "Removed";
                return new RawItem($"member:{m.Id}:{action.ToLowerInvariant()}", Ms(m.UpdatedOnUtc), m.UpdatedByUserId, action, "Member",
                    m.UserId.ToString(), SubjectId: m.UserId);
            }));

        // Issues created (also the ones promoted to tasks since).
        items.AddRange((await _context.Issues.AsNoTracking()
                .Where(i => i.OrganizationId == organizationId && i.CreatedOnUtc >= from && i.CreatedOnUtc < before)
                .OrderByDescending(i => i.CreatedOnUtc)
                .Take(count)
                .Select(i => new { i.Id, i.CreatedOnUtc, i.CreatedByUserId, i.Title })
                .ToListAsync(cancellationToken))
            .Select(i => new RawItem($"issue:{i.Id}:created", Ms(i.CreatedOnUtc), i.CreatedByUserId, "Created", "Issue", i.Id.ToString(), i.Title)));

        // Report exports of this organization (written by organization/member reports).
        var exports = _context.ReportExports.AsNoTracking().Where(e => e.OrganizationId == organizationId);
        if (!viewer.SeesEverything)
        {
            exports = exports.Where(e => e.RequestedByUserId == viewer.UserId || e.SubjectUserId == viewer.UserId);
        }

        items.AddRange((await exports
                .Where(e => e.CreatedOnUtc >= from && e.CreatedOnUtc < before)
                .OrderByDescending(e => e.CreatedOnUtc)
                .Take(count)
                .Select(e => new { e.Id, e.DocumentId, e.CreatedOnUtc, e.RequestedByUserId, e.SubjectUserId, e.Kind })
                .ToListAsync(cancellationToken))
            .Select(e => new RawItem($"report:{e.Id}:exported", Ms(e.CreatedOnUtc), e.RequestedByUserId, "Exported", "Report", e.DocumentId,
                e.DocumentId, e.SubjectUserId, e.Kind)));

        return items;
    }

    private async Task<List<ActivityItemDto>> DescribeAsync(List<RawItem> items, CancellationToken cancellationToken)
    {
        var userIds = items
            .SelectMany(i => new[] { i.ActorId, i.SubjectId })
            .OfType<Guid>()
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToList();

        var people = userIds.Count == 0
            ? new Dictionary<Guid, (string Email, string Name)>()
            : (await _context.Users.AsNoTracking()
                    .Where(u => userIds.Contains(u.Id))
                    .Select(u => new { u.Id, u.Email, u.DisplayName })
                    .ToListAsync(cancellationToken))
                .ToDictionary(u => u.Id, u => (Email: u.Email ?? string.Empty, Name: u.DisplayName ?? u.Email ?? Someone));

        string NameOf(Guid? id) => id is Guid known && people.TryGetValue(known, out var person) ? person.Name : Someone;

        return items.Select(item =>
        {
            var actorKnown = item.ActorId is Guid actorId && people.ContainsKey(actorId);
            var actor = NameOf(item.ActorId);
            var subject = NameOf(item.SubjectId);
            return new ActivityItemDto
            {
                Id = item.Id,
                Timestamp = item.Timestamp,
                ActorUserId = actorKnown ? item.ActorId : null,
                ActorDisplayName = actorKnown ? actor : null,
                ActorUserEmail = actorKnown ? people[item.ActorId!.Value].Email : null,
                ActionType = item.ActionType,
                EntityType = item.EntityType,
                EntityId = item.EntityId,
                Description = (item.EntityType, item.ActionType) switch
                {
                    ("Organization", _) => $"{actor} created the organization.",
                    ("Task", "Created") => $"{actor} created task '{item.Title}'.",
                    ("Task", _) => $"{actor} updated task '{item.Title}'.",
                    ("Issue", _) => $"{actor} created issue '{item.Title}'.",
                    ("Member", "Joined") => $"{subject} joined the organization.",
                    ("Member", "Left") => $"{subject} left the organization.",
                    ("Member", _) => $"{actor} removed {subject} from the organization.",
                    _ => item.Kind == "Member"
                        ? $"{actor} exported a member report for {subject} ({item.Title})."
                        : $"{actor} exported an organization report ({item.Title})."
                }
            };
        }).ToList();
    }

    /// <summary>Newest first; ties (same millisecond) by id, ordinal.</summary>
    private static List<RawItem> Sorted(IEnumerable<RawItem> items) =>
        items.OrderByDescending(i => i.Timestamp).ThenBy(i => i.Id, StringComparer.Ordinal).ToList();

    private static DateTime Ms(DateTime utc) =>
        new(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond, DateTimeKind.Utc);

    private static DateTime CeilToMillisecond(DateTime utc)
    {
        var floor = Ms(utc);
        return floor == utc ? floor : floor.AddMilliseconds(1);
    }

    // Query-string DateTimes bind as server-local time when they carry an offset or 'Z'; without one, read as UTC.
    private static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };
}
