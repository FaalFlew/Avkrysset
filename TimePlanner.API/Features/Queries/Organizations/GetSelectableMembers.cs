using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

public record GetSelectableMembersQuery(Guid OrganizationId) : IRequest<List<SelectableMemberDto>>;

public class GetSelectableMembersQueryHandler : IRequestHandler<GetSelectableMembersQuery, List<SelectableMemberDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetSelectableMembersQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<SelectableMemberDto>> Handle(GetSelectableMembersQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Only Admins/Owners need this list to assign tasks.
        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to view the member list.", cancellationToken);

        var members = await _context.OrganizationMemberships
            .AsNoTracking()
            .Where(m => m.OrganizationId == request.OrganizationId && m.Status == MembershipStatus.Active)
            .OrderBy(m => m.User.DisplayName ?? m.User.Email)
            .Select(m => new SelectableMemberDto
            {
                UserId = m.UserId,
                UserEmail = m.User.Email!,
                DisplayName = m.User.DisplayName ?? m.User.Email!
            })
            .ToListAsync(cancellationToken);

        return members;
    }
}