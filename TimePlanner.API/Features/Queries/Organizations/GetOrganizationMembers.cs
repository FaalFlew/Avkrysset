using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities; // We will create this for our authorization helper

namespace TimePlanner.API.Features.Queries.Organizations;

public record GetOrganizationMembersQuery(Guid OrganizationId) : IRequest<List<OrganizationMembershipDto>>;

public class GetOrganizationMembersQueryHandler : IRequestHandler<GetOrganizationMembersQuery, List<OrganizationMembershipDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetOrganizationMembersQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<OrganizationMembershipDto>> Handle(GetOrganizationMembersQuery request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null)
        {
            throw new UnauthorizedAccessException();
        }

        // Authorization Check: Ensure the current user is an Admin or Owner of this organization.
        await _context.RequireAdminOrOwner(userId.Value, request.OrganizationId,
            "You do not have permission to view members of this organization.", cancellationToken);

        // Query for the members, including their User details to get the email.
        var members = await _context.OrganizationMemberships
            .AsNoTracking()
            .Where(m => m.OrganizationId == request.OrganizationId)
            .OrderBy(m => m.User.DisplayName ?? m.User.Email)
            .Select(m => new OrganizationMembershipDto
            {
                MembershipId = m.Id,
                OrganizationId = m.OrganizationId,
                OrganizationName = m.Organization.Name,
                UserId = m.UserId,
                UserEmail = m.User.Email!,
                DisplayName = m.User.DisplayName ?? m.User.Email!,
                Role = m.Role,
                Status = m.Status,
                StatusMessage = m.StatusMessage
            })
            .ToListAsync(cancellationToken);

        return members;
    }
}