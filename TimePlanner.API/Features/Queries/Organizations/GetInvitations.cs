using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>The organization's pending, unexpired invitations, newest first (Owner/Admin).</summary>
public record GetOrganizationInvitationsQuery(Guid OrganizationId) : IRequest<List<OrganizationInvitationDto>>;

public class GetOrganizationInvitationsQueryHandler : IRequestHandler<GetOrganizationInvitationsQuery, List<OrganizationInvitationDto>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetOrganizationInvitationsQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<OrganizationInvitationDto>> Handle(GetOrganizationInvitationsQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to manage this organization's invitations.", cancellationToken);

        var now = DateTime.UtcNow;
        return await _context.OrganizationInvitations
            .AsNoTracking()
            .Where(i => i.OrganizationId == request.OrganizationId && i.Status == InvitationStatus.Pending && i.ExpiryUtc > now)
            .OrderByDescending(i => i.CreatedOnUtc)
            .ThenBy(i => i.Id)
            .Select(InvitationProjections.ToDto(now))
            .ToListAsync(cancellationToken);
    }
}

/// <summary>One invitation by id: visible to the invitee (by email) and to the organization's Owners and Admins; 404 for everyone else.</summary>
public record GetInvitationByIdQuery(Guid InvitationId) : IRequest<OrganizationInvitationDto>;

public class GetInvitationByIdQueryHandler : IRequestHandler<GetInvitationByIdQuery, OrganizationInvitationDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetInvitationByIdQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<OrganizationInvitationDto> Handle(GetInvitationByIdQuery request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        var email = await _context.Users.Where(u => u.Id == currentUserId).Select(u => u.Email).SingleOrDefaultAsync(cancellationToken)
                    ?? throw new UnauthorizedAccessException();

        var now = DateTime.UtcNow;
        var invitation = await _context.OrganizationInvitations
            .AsNoTracking()
            .Where(i => i.Id == request.InvitationId)
            .Select(InvitationProjections.ToDto(now))
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException(InvitationProjections.NotFoundMessage);

        var isInvitee = string.Equals(invitation.InvitedUserEmail, email, StringComparison.OrdinalIgnoreCase);
        if (!isInvitee && !await _context.IsAdminOrOwner(currentUserId.Value, invitation.OrganizationId, cancellationToken))
        {
            throw new KeyNotFoundException(InvitationProjections.NotFoundMessage);
        }

        return invitation;
    }
}

/// <summary>
/// The email link's landing page data for <paramref name="Token"/> (decision Q-F: no sign-in needed; the token is the
/// secret, and the invited address is masked). 404 for an unknown token.
/// </summary>
public record GetInvitationPreviewQuery(string Token) : IRequest<InvitationPreviewDto>;

public class GetInvitationPreviewQueryHandler : IRequestHandler<GetInvitationPreviewQuery, InvitationPreviewDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetInvitationPreviewQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<InvitationPreviewDto> Handle(GetInvitationPreviewQuery request, CancellationToken cancellationToken)
    {
        var invitation = await _context.OrganizationInvitations
            .AsNoTracking()
            .Where(i => i.Token == request.Token)
            .Select(i => new
            {
                i.OrganizationId,
                OrganizationName = i.Organization.Name,
                i.Role,
                InvitedBy = i.Inviter.DisplayName ?? i.Inviter.Email!,
                i.InvitedUserEmail,
                i.Status,
                i.ExpiryUtc
            })
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new KeyNotFoundException(InvitationProjections.NotFoundMessage);

        bool? matchesCurrentUser = null;
        if (_currentUserService.UserId is Guid userId)
        {
            var email = await _context.Users.Where(u => u.Id == userId).Select(u => u.Email).SingleOrDefaultAsync(cancellationToken);
            if (email is not null)
            {
                matchesCurrentUser = string.Equals(email, invitation.InvitedUserEmail, StringComparison.OrdinalIgnoreCase);
            }
        }

        return new InvitationPreviewDto
        {
            OrganizationId = invitation.OrganizationId,
            OrganizationName = invitation.OrganizationName,
            Role = invitation.Role,
            InvitedByDisplayName = invitation.InvitedBy,
            InvitedEmailMasked = InvitationProjections.MaskEmail(invitation.InvitedUserEmail),
            Status = InvitationProjections.EffectiveStatus(invitation.Status, invitation.ExpiryUtc, DateTime.UtcNow),
            ExpiryUtc = invitation.ExpiryUtc,
            MatchesCurrentUser = matchesCurrentUser
        };
    }
}
