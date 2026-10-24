using FluentValidation;
using MediatR;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>
/// Organization analytics for Owners and Admins. Selection: view=monthly|weekly|daily, year, from, to (as for reports),
/// resolved in the organization's zone.
/// </summary>
public record GetOrganizationAnalyticsQuery(Guid OrganizationId, string? View, int? Year, int? From, int? To)
    : IRequest<OrganizationAnalyticsDto>;

public class GetOrganizationAnalyticsQueryValidator : AbstractValidator<GetOrganizationAnalyticsQuery>
{
    public GetOrganizationAnalyticsQueryValidator() =>
        OrganizationAnalytics.AddSelectionRule(this, q => (q.View, q.Year, q.From, q.To));
}

public class GetOrganizationAnalyticsQueryHandler : IRequestHandler<GetOrganizationAnalyticsQuery, OrganizationAnalyticsDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<GetOrganizationAnalyticsQueryHandler> _logger;

    public GetOrganizationAnalyticsQueryHandler(
        ApplicationDbContext context, ICurrentUserService currentUserService, ILogger<GetOrganizationAnalyticsQueryHandler> logger)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
    }

    public async Task<OrganizationAnalyticsDto> Handle(GetOrganizationAnalyticsQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to view analytics for this organization.", cancellationToken);

        var range = await OrganizationAnalytics.ResolveAsync(
            _context, request.OrganizationId, request.View, request.Year, request.From, request.To, _logger, cancellationToken);
        var tasks = await OrganizationAnalytics.LoadTasksAsync(_context, request.OrganizationId, range, null, cancellationToken);

        var people = await OrganizationAnalytics.PeopleAsync(
            _context, request.OrganizationId, tasks.SelectMany(t => t.AssigneeIds).Distinct().ToList(), cancellationToken);

        var timePerMember = AnalyticsOrder.Sort(
            tasks
                .SelectMany(t => t.AssigneeIds.Select(memberId => (MemberId: memberId, t.Duration)))
                .GroupBy(a => a.MemberId)
                .Select(g =>
                {
                    var person = people.GetValueOrDefault(g.Key);
                    return new TimePerMemberDto
                    {
                        MemberId = g.Key,
                        DisplayName = person?.DisplayName ?? string.Empty,
                        MemberEmail = person?.Email ?? string.Empty,
                        MemberStatus = person?.Status ?? MembershipStatus.Removed,
                        TotalHours = g.Sum(a => a.Duration)
                    };
                }),
            m => m.TotalHours, m => m.DisplayName, m => m.MemberId);

        var dto = OrganizationAnalytics.Fill(new OrganizationAnalyticsDto(), request.OrganizationId, range, tasks);
        dto.TimePerMember = timePerMember;
        dto.AssignedHours = timePerMember.Sum(m => m.TotalHours);
        return dto;
    }
}
