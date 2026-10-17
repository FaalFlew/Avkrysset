using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Exceptions;
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
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public JoinOrganizationCommandHandler(
        ApplicationDbContext context,
        ICurrentUserService currentUserService,
        ILogger<JoinOrganizationCommandHandler> logger,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
        _notificationService = notificationService; // INJECT

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
        var existingMembership = await _context.OrganizationMemberships
            .FirstOrDefaultAsync(m => m.OrganizationId == organization.Id && m.UserId == userId, cancellationToken);

        if (existingMembership != null)
        {
            // If the user previously left, we can reactivate their membership.
            // You might want different logic here, e.g., "You are already a member."
            if (existingMembership.Status == MembershipStatus.Left || existingMembership.Status == MembershipStatus.Removed)
            {
                existingMembership.Status = MembershipStatus.Active;
                // You could decide to re-assign the role based on the new code or keep the old one.
                // Let's re-assign for now, allowing an upgrade from Member to Admin.
                existingMembership.Role = assignedRole;
                await _context.SaveChangesAsync(cancellationToken);

                _logger.LogInformation("User {UserId} rejoined Organization {OrganizationId} as {Role}.", userId, organization.Id, assignedRole);
                return MapToDto(existingMembership, organization.Name);
            }

            // If their status is already Active, we throw a conflict.
            throw new ConflictException("You are already an active member of this organization.");
        }

        // 4. Create the new membership.
        var newMembership = new OrganizationMembership
        {
            OrganizationId = organization.Id,
            UserId = userId.Value,
            Role = assignedRole,
            Status = MembershipStatus.Active
        };

        _context.OrganizationMemberships.Add(newMembership);
        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("User {UserId} successfully joined Organization {OrganizationId} as {Role}.", userId, organization.Id, assignedRole);


        var membershipDto = MapToDto(newMembership, organization.Name); // Use your existing MapToDto helper

        // --- NOTIFICATION LOGIC ---
        await _notificationService.MemberJoined(organization.Id, membershipDto);

        return membershipDto;
    }

    private OrganizationMembershipDto MapToDto(OrganizationMembership membership, string organizationName)
    {
        // We'll need the user's email for the DTO. A real app might have this cached
        // or would need another DB query. For now, let's assume we can get it.
        // This is a good place to demonstrate a potential N+1 problem if not handled carefully.
        // For now, we'll leave it as a placeholder.
        var user = _context.Users
            .Where(u => u.Id == membership.UserId)
            .Select(u => new { u.Email, u.DisplayName })
            .FirstOrDefault();

        return new OrganizationMembershipDto
        {
            MembershipId = membership.Id,
            OrganizationId = membership.OrganizationId,
            OrganizationName = organizationName,
            UserId = membership.UserId,
            UserEmail = user?.Email ?? "N/A",
            DisplayName = user?.DisplayName ?? user?.Email ?? "N/A",
            Role = membership.Role,
            Status = membership.Status,
            StatusMessage = membership.StatusMessage
        };
    }
}