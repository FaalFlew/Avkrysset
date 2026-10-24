using System.Net;
using System.Security.Cryptography;
using FluentValidation;
using MediatR;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Queries.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record InviteUserCommand(Guid OrganizationId, string Email, string Role) : IRequest<OrganizationInvitationDto>;

public class InviteUserCommandValidator : AbstractValidator<InviteUserCommand>
{
    public InviteUserCommandValidator()
    {
        RuleFor(x => x.OrganizationId).NotEmpty();
        RuleFor(x => x.Email).Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Email is required.") // also rejects whitespace only
            .EmailAddress().WithMessage("A valid email address is required.");
        RuleFor(x => x.Role).Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Role is required.")
            .Must(role => role == OrganizationRoles.Admin || role == OrganizationRoles.Member)
            .WithMessage("Role must be 'Admin' or 'Member'.");
    }
}

/// <summary>
/// Invites an email address (Owner/Admin). 409 when that address is already an active member or already has an
/// unexpired pending invitation; an expired pending one is marked Expired first, so it no longer blocks a new invite.
/// The email links to {FrontendBaseUrl}/invitations/{token}.
/// </summary>
public class InviteUserCommandHandler : IRequestHandler<InviteUserCommand, OrganizationInvitationDto>
{
    public const int ValidForDays = 7;

    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;

    public InviteUserCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService, IEmailService emailService, IConfiguration configuration)
    {
        _context = context;
        _currentUserService = currentUserService;
        _emailService = emailService;
        _configuration = configuration;
    }

    public async Task<OrganizationInvitationDto> Handle(InviteUserCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Must be Admin or Owner.
        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to invite users to this organization.", cancellationToken);

        var email = request.Email.Trim();

        // Validation: Check if user is already an active member.
        var isAlreadyMember = await _context.OrganizationMemberships
            .AnyAsync(m => m.OrganizationId == request.OrganizationId &&
                           m.User.Email == email &&
                           m.Status == MembershipStatus.Active, cancellationToken);
        if (isAlreadyMember)
        {
            throw new ConflictException($"The user with email '{email}' is already an active member of this organization.");
        }

        // At most one Pending invitation per organization and email (filtered unique index). An expired one is marked
        // Expired so it stops blocking; an unexpired one means this address is already invited.
        var now = DateTime.UtcNow;
        var pending = await _context.OrganizationInvitations
            .FirstOrDefaultAsync(i => i.OrganizationId == request.OrganizationId &&
                                      i.InvitedUserEmail == email &&
                                      i.Status == InvitationStatus.Pending, cancellationToken);
        if (pending != null)
        {
            if (pending.ExpiryUtc > now)
            {
                throw AlreadyInvited(email);
            }

            pending.Status = InvitationStatus.Expired;
            await _context.SaveChangesAsync(cancellationToken);
        }

        // A secure, URL-safe token: 32 random bytes = 43 base64url characters (never shaped like a GUID).
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

        var organization = await _context.Organizations.AsNoTracking().SingleAsync(o => o.Id == request.OrganizationId, cancellationToken);

        var invitation = new OrganizationInvitation
        {
            OrganizationId = request.OrganizationId,
            InviterId = currentUserId.Value,
            InvitedUserEmail = email,
            Role = request.Role,
            Token = token,
            ExpiryUtc = now.AddDays(ValidForDays)
        };

        _context.OrganizationInvitations.Add(invitation);
        try
        {
            await _context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (DbErrors.IsUniqueViolation(ex))
        {
            // Another admin invited the same address at the same moment.
            throw AlreadyInvited(email);
        }

        // Send invitation email. Everything user-supplied is HTML-encoded (an organization name is free text).
        var frontendUrl = _configuration["FrontendBaseUrl"];
        var acceptLink = $"{frontendUrl}/invitations/{token}";
        var orgName = WebUtility.HtmlEncode(organization.Name);
        var role = WebUtility.HtmlEncode(request.Role);
        var emailBody = $"<h1>Invitation to Join {orgName}</h1>" +
                        $"<p>You have been invited to join the '{orgName}' organization on Time Planner as a(n) {role}.</p>" +
                        $"<p>Click the link below to accept or decline the invitation. This link will expire in {ValidForDays} days.</p>" +
                        $"<p><a href=\"{WebUtility.HtmlEncode(acceptLink)}\">View invitation</a></p>" +
                        $"<p>If you were not expecting this, you can safely ignore this email.</p>";

        await _emailService.SendEmailAsync(email, $"You're invited to join {organization.Name} on Time Planner", emailBody);

        return await _context.OrganizationInvitations
            .AsNoTracking()
            .Where(i => i.Id == invitation.Id)
            .Select(InvitationProjections.ToDto(now))
            .SingleAsync(cancellationToken);
    }

    private static ConflictException AlreadyInvited(string email) =>
        new($"'{email}' already has a pending invitation to this organization.");
}
