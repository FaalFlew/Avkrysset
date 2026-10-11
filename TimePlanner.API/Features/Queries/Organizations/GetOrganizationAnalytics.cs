using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

public record GetOrganizationAnalyticsQuery(
    Guid OrganizationId,
    DateTime StartDate,
    DateTime EndDate) : IRequest<OrganizationAnalyticsDto>;

public class GetOrganizationAnalyticsQueryHandler : IRequestHandler<GetOrganizationAnalyticsQuery, OrganizationAnalyticsDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetOrganizationAnalyticsQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<OrganizationAnalyticsDto> Handle(GetOrganizationAnalyticsQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: User must be an Admin or Owner.
        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to view analytics for this organization.", cancellationToken);

        // 1. Get all relevant tasks within the date range for the specified organization.
        // We select only the properties we need to minimize data transfer.
        var tasksQuery = _context.Tasks
            .AsNoTracking()
            .Where(t => t.OrganizationId == request.OrganizationId &&
                        t.Start >= request.StartDate &&
                        t.Start < request.EndDate)
            .Select(t => new
            {
                t.Duration,
                t.CategoryId,
                CategoryName = t.Category.Name,
                CategoryColor = t.Category.Color,
                Assignments = t.Assignments.Select(a => new
                {
                    a.AssigneeId,
                    AssigneeEmail = a.Assignee.Email,
                    AssigneeDisplayName = a.Assignee.DisplayName ?? a.Assignee.Email
                })
            });

        var tasks = await tasksQuery.ToListAsync(cancellationToken);

        // 2. Aggregate Time Per Category
        var timePerCategory = tasks
            .GroupBy(t => new { t.CategoryId, t.CategoryName, t.CategoryColor })
            .Select(g => new TimePerCategoryDto
            {
                CategoryId = g.Key.CategoryId,
                CategoryName = g.Key.CategoryName,
                CategoryColor = g.Key.CategoryColor,
                TotalHours = g.Sum(t => t.Duration)
            })
            .OrderByDescending(dto => dto.TotalHours)
            .ToList();

        // 3. Aggregate Time Per Member
        // This is more complex due to the many-to-many relationship.
        var timePerMember = tasks
            .SelectMany(t => t.Assignments.Select(a => new { MemberId = a.AssigneeId, MemberEmail = a.AssigneeEmail, a.AssigneeDisplayName, t.Duration }))
            .GroupBy(a => new { a.MemberId, a.MemberEmail, a.AssigneeDisplayName })
            .Select(g => new TimePerMemberDto
            {
                MemberId = g.Key.MemberId,
                MemberEmail = g.Key.MemberEmail!,
                DisplayName = g.Key.AssigneeDisplayName!,
                TotalHours = g.Sum(a => a.Duration)
            })
            .OrderByDescending(dto => dto.TotalHours)
            .ToList();

        // 4. Calculate total hours
        var totalHours = tasks.Sum(t => t.Duration);

        return new OrganizationAnalyticsDto
        {
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            TimePerCategory = timePerCategory,
            TimePerMember = timePerMember,
            TotalHours = totalHours
        };
    }
}