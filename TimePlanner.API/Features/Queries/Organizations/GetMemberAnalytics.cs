using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

public record GetMemberAnalyticsQuery(
    Guid OrganizationId,
    Guid MemberId,
    DateTime StartDate,
    DateTime EndDate) : IRequest<MemberAnalyticsDto>;

public class GetMemberAnalyticsQueryHandler : IRequestHandler<GetMemberAnalyticsQuery, MemberAnalyticsDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetMemberAnalyticsQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<MemberAnalyticsDto> Handle(GetMemberAnalyticsQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization check
        var isViewingSelf = currentUserId == request.MemberId;
        var isAdminOrOwner = await _context.IsAdminOrOwner(currentUserId.Value, request.OrganizationId, cancellationToken);

        // User must be an Admin/Owner OR viewing their own analytics.
        if (!isAdminOrOwner && !isViewingSelf)
        {
            throw new UnauthorizedAccessException("You do not have permission to view this member's analytics.");
        }

        // Ensure the target member is actually part of the organization.
        var targetMember = await _context.Users
            .AsNoTracking()
            .Where(u => u.Id == request.MemberId && u.OrganizationMemberships.Any(m => m.OrganizationId == request.OrganizationId))
            .Select(u => new { u.Id, u.Email })
            .SingleOrDefaultAsync(cancellationToken);

        if (targetMember == null)
        {
            throw new KeyNotFoundException("The specified member was not found in this organization.");
        }

        // --- Query Logic ---
        var tasksQuery = _context.Tasks
            .AsNoTracking()
            .Where(t => t.OrganizationId == request.OrganizationId &&
                        t.Start >= request.StartDate &&
                        t.Start < request.EndDate.AddDays(1) &&
                        // Filter to tasks assigned to the target member
                        t.Assignments.Any(a => a.AssigneeId == request.MemberId));

        // 1. Aggregate Time Per Category for this member's tasks
        var timePerCategory = await tasksQuery
            .GroupBy(t => new { t.CategoryId, t.Category.Name, t.Category.Color })
            .Select(g => new TimePerCategoryDto
            {
                CategoryId = g.Key.CategoryId,
                CategoryName = g.Key.Name,
                CategoryColor = g.Key.Color,
                TotalHours = g.Sum(t => t.Duration)
            })
            .OrderByDescending(dto => dto.TotalHours)
            .ToListAsync(cancellationToken);

        // 2. Calculate total hours
        var totalHours = await tasksQuery.SumAsync(t => t.Duration, cancellationToken);

        return new MemberAnalyticsDto
        {
            MemberId = targetMember.Id,
            MemberEmail = targetMember.Email!,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            TimePerCategory = timePerCategory,
            TotalHours = totalHours
        };
    }
}