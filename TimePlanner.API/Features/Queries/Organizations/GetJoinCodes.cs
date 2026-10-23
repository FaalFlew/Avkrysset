using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

public record GetJoinCodesQuery(Guid OrganizationId) : IRequest<JoinCodesDto>;

public class GetJoinCodesQueryHandler : IRequestHandler<GetJoinCodesQuery, JoinCodesDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetJoinCodesQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<JoinCodesDto> Handle(GetJoinCodesQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: CRITICAL - Only the owner can view the join codes.
        if (!await _context.IsOwner(currentUserId.Value, request.OrganizationId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You do not have permission to view the join codes for this organization.");
        }

        var codes = await _context.Organizations
            .AsNoTracking()
            .Where(o => o.Id == request.OrganizationId)
            .Select(o => new JoinCodesDto
            {
                OrganizationId = o.Id,
                MemberJoinCode = o.MemberJoinCode,
                MemberJoinCodeExpiryUtc = o.MemberJoinCodeExpiryUtc,
                AdminJoinCode = o.AdminJoinCode,
                AdminJoinCodeExpiryUtc = o.AdminJoinCodeExpiryUtc
            })
            .SingleOrDefaultAsync(cancellationToken);

        if (codes == null)
        {
            throw new KeyNotFoundException("Organization not found.");
        }

        return codes;
    }
}