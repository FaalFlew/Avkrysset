using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;
using TimePlanner.API.Features.Queries.Tasks;

namespace TimePlanner.API.Features.Queries.Organizations;

// All parameters are optional to allow for flexible filtering.
public record GetOrganizationTasksQuery(
    Guid OrganizationId,
    DateTime StartDate,
    DateTime EndDate,
    Guid? MemberId) : IRequest<List<TaskItemDto>>;

public class GetOrganizationTasksQueryHandler : IRequestHandler<GetOrganizationTasksQuery, List<TaskItemDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetOrganizationTasksQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<TaskItemDto>> Handle(GetOrganizationTasksQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: User must be an active member.
        var membership = await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);

        bool isUserAdminOrOwner = AuthorizationExtensions.IsAdminOrOwnerRole(membership.Role);

        // --- Authorization Logic for Filtering ---
        Guid? targetMemberId = null;
        if (isUserAdminOrOwner)
        {
            // Admins/Owners can filter by any memberId, or see all if none is provided.
            targetMemberId = request.MemberId;
        }
        else
        {
            // Members can ONLY see their own tasks.
            // If they try to filter by someone else, we ignore it and force it to their ID.
            targetMemberId = currentUserId;
        }

        // --- Query Building ---
        var query = _context.Tasks
            .AsNoTracking()
            .Where(t => t.OrganizationId == request.OrganizationId &&
                        t.Start >= request.StartDate &&
                        t.Start < request.EndDate);

        // If a specific member is targeted, we filter by their assignments.
        if (targetMemberId.HasValue)
        {
            query = query.Where(t => t.Assignments.Any(a => a.AssigneeId == targetMemberId.Value));
        }

        // Project the results into our DTO.
        var tasks = await query
            .OrderBy(t => t.Start)
            .Select(TaskProjections.ToDto)
            .ToListAsync(cancellationToken);

        TaskProjections.ApplyCapabilities(tasks, currentUserId.Value,
            new Dictionary<Guid, string> { [request.OrganizationId] = membership.Role });
        return tasks;
    }
}