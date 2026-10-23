using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Models.Organization;
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

        // 1. Find all active organizations the user is a member of.
        var myOrganizationIds = await _context.OrganizationMemberships
            .AsNoTracking()
            .Where(m => m.UserId == currentUserId && m.Status == MembershipStatus.Active)
            .Select(m => m.OrganizationId)
            .ToListAsync(cancellationToken);

        if (!myOrganizationIds.Any())
        {
            return new List<TaskItemDto>();
        }

        // 2. Fetch all tasks within the date range that are assigned to the user
        //    AND belong to one of their active organizations.
        var tasks = await _context.Tasks
            .AsNoTracking()
            .Where(t => t.OrganizationId.HasValue && myOrganizationIds.Contains(t.OrganizationId.Value))
            .Where(t => t.Start >= request.StartDate && t.Start < request.EndDate.AddDays(1))
            .Where(t => t.Assignments.Any(a => a.AssigneeId == currentUserId))
            .Include(t => t.Category)
            .Include(t => t.Assignments)
                .ThenInclude(a => a.Assignee)
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
                TemplateId = t.TemplateId,
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