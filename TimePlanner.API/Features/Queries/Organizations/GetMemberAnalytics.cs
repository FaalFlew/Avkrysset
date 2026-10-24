using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>
/// One member's analytics (the organization's tasks assigned to them), in the organization's zone. Owners and Admins
/// may ask for anyone who ever was a member; a member only for themselves (403 otherwise). 404 for someone who never
/// was a member.
/// </summary>
public record GetMemberAnalyticsQuery(Guid OrganizationId, Guid MemberId, string? View, int? Year, int? From, int? To)
    : IRequest<MemberAnalyticsDto>;

public class GetMemberAnalyticsQueryValidator : AbstractValidator<GetMemberAnalyticsQuery>
{
    public GetMemberAnalyticsQueryValidator() =>
        OrganizationAnalytics.AddSelectionRule(this, q => (q.View, q.Year, q.From, q.To));
}

public class GetMemberAnalyticsQueryHandler : IRequestHandler<GetMemberAnalyticsQuery, MemberAnalyticsDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<GetMemberAnalyticsQueryHandler> _logger;

    public GetMemberAnalyticsQueryHandler(
        ApplicationDbContext context, ICurrentUserService currentUserService, ILogger<GetMemberAnalyticsQueryHandler> logger)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
    }

    public async Task<MemberAnalyticsDto> Handle(GetMemberAnalyticsQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: an active member, who must be an Admin/Owner OR viewing their own analytics.
        var membership = await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);
        var isViewingSelf = currentUserId == request.MemberId;
        if (!AuthorizationExtensions.IsAdminOrOwnerRole(membership.Role) && !isViewingSelf)
        {
            throw new ForbiddenException("You do not have permission to view this member's analytics.");
        }

        // The target must be or have been a member (people who left or were removed keep their history).
        var isOrWasMember = await _context.OrganizationMemberships
            .AnyAsync(m => m.OrganizationId == request.OrganizationId && m.UserId == request.MemberId, cancellationToken);
        if (!isOrWasMember)
        {
            throw new KeyNotFoundException("The specified member was not found in this organization.");
        }

        var range = await OrganizationAnalytics.ResolveAsync(
            _context, request.OrganizationId, request.View, request.Year, request.From, request.To, _logger, cancellationToken);
        var tasks = await OrganizationAnalytics.LoadTasksAsync(_context, request.OrganizationId, range, request.MemberId, cancellationToken);
        var person = (await OrganizationAnalytics.PeopleAsync(_context, request.OrganizationId, new[] { request.MemberId }, cancellationToken))
            [request.MemberId];

        var dto = OrganizationAnalytics.Fill(new MemberAnalyticsDto(), request.OrganizationId, range, tasks);
        dto.MemberId = person.Id;
        dto.DisplayName = person.DisplayName;
        dto.MemberEmail = person.Email;
        dto.MemberStatus = person.Status;
        return dto;
    }
}
