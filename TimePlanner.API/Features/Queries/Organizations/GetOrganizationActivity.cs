using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

public record GetOrganizationActivityQuery(Guid OrganizationId, int Limit = 50) : IRequest<List<ActivityLogDto>>;

public class GetOrganizationActivityQueryHandler : IRequestHandler<GetOrganizationActivityQuery, List<ActivityLogDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetOrganizationActivityQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<ActivityLogDto>> Handle(GetOrganizationActivityQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Any active member can view the activity log.
        // Members who left or were removed no longer see the feed.
        await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);

        var activityLogs = new List<ActivityLogDto>();

        // 1. Get Task Creation/Update Activities
        var taskActivities = await _context.Tasks
            .AsNoTracking()
            .Where(t => t.OrganizationId == request.OrganizationId)
            .Include(t => t.User) // User who created it
            .OrderByDescending(t => t.UpdatedOnUtc ?? t.CreatedOnUtc)
            .Take(request.Limit)
            .Select(t => new { t.Title, t.CreatedOnUtc, t.UpdatedOnUtc, ActorEmail = t.User.Email, ActorName = t.User.DisplayName ?? t.User.Email, ActorId = t.UserId })
            .ToListAsync(cancellationToken);

        foreach (var activity in taskActivities)
        {
            if (activity.UpdatedOnUtc.HasValue)
            {
                activityLogs.Add(new ActivityLogDto
                {
                    Timestamp = activity.UpdatedOnUtc.Value,
                    ActorUserId = activity.ActorId,
                    ActorUserEmail = activity.ActorEmail!,
                    ActorDisplayName = activity.ActorName!,
                    ActionType = "Updated",
                    EntityType = "Task",
                    Description = $"Task '{activity.Title}' was updated."
                });
            }
            activityLogs.Add(new ActivityLogDto
            {
                Timestamp = activity.CreatedOnUtc,
                ActorUserId = activity.ActorId,
                ActorUserEmail = activity.ActorEmail!,
                ActorDisplayName = activity.ActorName!,
                ActionType = "Created",
                EntityType = "Task",
                Description = $"Task '{activity.Title}' was created."
            });
        }

        // 2. Get Membership Activities (Joined, Left, Removed)
        var membershipActivities = await _context.OrganizationMemberships
            .AsNoTracking()
            .Where(m => m.OrganizationId == request.OrganizationId)
            .Include(m => m.User) // User who is the subject of the action
            .OrderByDescending(m => m.CreatedOnUtc)
            .Take(request.Limit)
            .Select(m => new { m.CreatedOnUtc, m.Status, SubjectEmail = m.User.Email, SubjectName = m.User.DisplayName ?? m.User.Email, SubjectId = m.UserId })
            .ToListAsync(cancellationToken);

        foreach (var activity in membershipActivities)
        {
            activityLogs.Add(new ActivityLogDto
            {
                Timestamp = activity.CreatedOnUtc,
                ActorUserId = activity.SubjectId,
                ActorUserEmail = activity.SubjectEmail!,
                ActorDisplayName = activity.SubjectName!,
                ActionType = "Joined",
                EntityType = "Organization",
                Description = $"{activity.SubjectName} joined the organization."
            });
            // Note: We don't have a good way to show who "Removed" a member without changing the model. This is a good V2 improvement.
        }

        // 3. Get Issue Creation/Update Activities (similar to tasks)
        // ... You would add logic here similar to the task activities ...

        // Final sorting and trimming
        return activityLogs
            .OrderByDescending(log => log.Timestamp)
            .Take(request.Limit)
            .ToList();
    }
}