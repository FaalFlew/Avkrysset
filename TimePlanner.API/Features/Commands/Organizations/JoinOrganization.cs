using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Queries.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Organizations;

public record JoinOrganizationCommand(string JoinCode) : IRequest<OrganizationMembershipDto>;

public class JoinOrganizationCommandValidator : AbstractValidator<JoinOrganizationCommand>
{
    public JoinOrganizationCommandValidator()
    {
        RuleFor(x => x.JoinCode).NotEmpty().Length(8);
    }
}

public class JoinOrganizationCommandHandler : IRequestHandler<JoinOrganizationCommand, OrganizationMembershipDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<JoinOrganizationCommandHandler> _logger;
    private readonly IOrganizationNotificationService _notificationService;

    public JoinOrganizationCommandHandler(
        ApplicationDbContext context,
        ICurrentUserService currentUserService,
        ILogger<JoinOrganizationCommandHandler> logger,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
        _notificationService = notificationService;
    }

    public async Task<OrganizationMembershipDto> Handle(JoinOrganizationCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null)
        {
            throw new UnauthorizedAccessException();
        }

        // 1. Find the organization by either the Member or Admin join code.
        var organization = await _context.Organizations
            .FirstOrDefaultAsync(o => o.MemberJoinCode == request.JoinCode || o.AdminJoinCode == request.JoinCode, cancellationToken);

        if (organization == null)
        {
            throw new KeyNotFoundException("Invalid join code.");
        }

        // 2. Determine the role based on which code was used and check its expiry.
        string assignedRole;
        if (organization.MemberJoinCode == request.JoinCode)
        {
            if (organization.MemberJoinCodeExpiryUtc < DateTime.UtcNow)
            {
                throw new BadRequestException("This member join code has expired.");
            }
            assignedRole = OrganizationRoles.Member;
        }
        else // It must be the Admin join code
        {
            if (organization.AdminJoinCodeExpiryUtc < DateTime.UtcNow)
            {
                throw new BadRequestException("This admin join code has expired.");
            }
            assignedRole = OrganizationRoles.Admin;
        }

        // 3. Check if the user is already a member of this organization.
        var membership = await _context.OrganizationMemberships
            .FirstOrDefaultAsync(m => m.OrganizationId == organization.Id && m.UserId == userId, cancellationToken);

        if (membership != null)
        {
            if (membership.Status == MembershipStatus.Active)
            {
                throw new ConflictException("You are already an active member of this organization.");
            }

            // Someone who left or was removed rejoins with the role of the code they used.
            membership.Status = MembershipStatus.Active;
            membership.Role = assignedRole;
            await _context.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("User {UserId} rejoined Organization {OrganizationId} as {Role}.", userId, organization.Id, assignedRole);
        }
        else
        {
            membership = new OrganizationMembership
            {
                OrganizationId = organization.Id,
                UserId = userId.Value,
                Role = assignedRole,
                Status = MembershipStatus.Active
            };
            _context.OrganizationMemberships.Add(membership);
            await _context.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("User {UserId} successfully joined Organization {OrganizationId} as {Role}.", userId, organization.Id, assignedRole);
        }

        var membershipDto = await MembershipProjections.LoadAsync(_context, membership.Id, cancellationToken);

        // A re-join is a join for everyone watching the organization.
        await _notificationService.MemberJoined(organization.Id, membershipDto);

        return membershipDto;
    }
}
