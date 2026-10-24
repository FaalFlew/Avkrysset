using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>
/// One organization task with the caller's capabilities. Owners and Admins see every task; a member only tasks
/// assigned to them or created by them (decision Q6) - others are 404, like a task that doesn't exist.
/// </summary>
public record GetOrganizationTaskQuery(Guid OrganizationId, Guid TaskId) : IRequest<TaskItemDto>;

public class GetOrganizationTaskQueryHandler : IRequestHandler<GetOrganizationTaskQuery, TaskItemDto>
{
    public const string NotFoundMessage = "Task not found in this organization.";

    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetOrganizationTaskQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<TaskItemDto> Handle(GetOrganizationTaskQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        var membership = await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);
        var me = currentUserId.Value;
        var seesAll = AuthorizationExtensions.IsAdminOrOwnerRole(membership.Role);

        var task = await _context.Tasks
            .AsNoTracking()
            .Where(t => t.Id == request.TaskId && t.OrganizationId == request.OrganizationId)
            .Where(t => seesAll || t.UserId == me || t.Assignments.Any(a => a.AssigneeId == me))
            .Select(TaskProjections.ToDto)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException(NotFoundMessage);

        return task.WithCapabilities(TaskCapabilities.For(task.OrganizationId, task.CreatedBy.UserId, me, membership.Role));
    }
}
