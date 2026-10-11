using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

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

        var membership = await _context.OrganizationMemberships
            .AsNoTracking()
            .FirstOrDefaultAsync(m => m.OrganizationId == request.OrganizationId && m.UserId == currentUserId, cancellationToken);

        // Authorization: User must be an active member.
        if (membership == null || membership.Status != MembershipStatus.Active)
        {
            throw new UnauthorizedAccessException("You are not an active member of this organization.");
        }

        bool isUserAdminOrOwner = membership.Role == OrganizationRoles.Admin || membership.Role == OrganizationRoles.Owner;

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
                        t.Start < request.EndDate.AddDays(1));

        // If a specific member is targeted, we filter by their assignments.
        if (targetMemberId.HasValue)
        {
            query = query.Where(t => t.Assignments.Any(a => a.AssigneeId == targetMemberId.Value));
        }

        // Project the results into our DTO.
        var tasks = await query
            .Include(t => t.Category)
            .Include(t => t.Assignments)
                .ThenInclude(a => a.Assignee) // Include User details for each assignee
            .OrderBy(t => t.Start)
            .Select(t => new TaskItemDto
            {
                Id = t.Id,
                Title = t.Title,
                Start = t.Start,
                Duration = t.Duration,
                CategoryId = t.CategoryId,
                CategoryName = t.Category.Name,
                CategoryColor = t.Category.Color,
                OrganizationId = t.OrganizationId,
                TemplateId = t.TemplateId, // Include templateId if it exists
                Assignees = t.Assignments.Select(a => new TaskAssigneeDto
                {
                    UserId = a.AssigneeId,
                    UserEmail = a.Assignee.Email!
                }).ToList()
            })
            .ToListAsync(cancellationToken);

        return tasks;
    }
}