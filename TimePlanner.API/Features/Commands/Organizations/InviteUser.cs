using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using Microsoft.AspNetCore.WebUtilities;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Exceptions;
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
        RuleFor(x => x.Email).NotEmpty().EmailAddress();
        RuleFor(x => x.Role)
            .NotEmpty()
            .Must(role => role == OrganizationRoles.Admin || role == OrganizationRoles.Member)
            .WithMessage("Role must be 'Admin' or 'Member'.");
    }
}

public class InviteUserCommandHandler : IRequestHandler<InviteUserCommand, OrganizationInvitationDto>
{
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
        if (!await _context.IsAdminOrOwner(currentUserId.Value, request.OrganizationId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You do not have permission to invite users to this organization.");
        }

        // Validation: Check if user is already an active member.
        var isAlreadyMember = await _context.OrganizationMemberships
            .AnyAsync(m => m.OrganizationId == request.OrganizationId &&
                           m.User.Email == request.Email &&
                           m.Status == MembershipStatus.Active, cancellationToken);
        if (isAlreadyMember)
        {
            throw new ConflictException($"The user with email '{request.Email}' is already an active member of this organization.");
        }

        // Generate a secure, URL-safe token
        var tokenBytes = RandomNumberGenerator.GetBytes(32);
        var token = WebEncoders.Base64UrlEncode(tokenBytes);

        var organization = await _context.Organizations.AsNoTracking().SingleAsync(o => o.Id == request.OrganizationId, cancellationToken);

        var invitation = new OrganizationInvitation
        {
            OrganizationId = request.OrganizationId,
            InviterId = currentUserId.Value,
            InvitedUserEmail = request.Email,
            Role = request.Role,
            Token = token,
            ExpiryUtc = DateTime.UtcNow.AddDays(7)
        };

        _context.OrganizationInvitations.Add(invitation);
        await _context.SaveChangesAsync(cancellationToken);

        // Send invitation email
        var frontendUrl = _configuration["FrontendBaseUrl"];
        var acceptLink = $"{frontendUrl}/accept-invite?token={token}";
        var emailBody = $"<h1>Invitation to Join {organization.Name}</h1>" +
                        $"<p>You have been invited to join the '{organization.Name}' organization on Time Planner as a(n) {request.Role}.</p>" +
                        $"<p>Click the link below to accept the invitation. This link will expire in 7 days.</p>" +
                        $"<p><a href='{acceptLink}'>Accept Invitation</a></p>" +
                        $"<p>If you were not expecting this, you can safely ignore this email.</p>";

        await _emailService.SendEmailAsync(request.Email, $"You're invited to join {organization.Name} on Time Planner", emailBody);

        return new OrganizationInvitationDto
        {
            Id = invitation.Id,
            OrganizationId = invitation.OrganizationId,
            OrganizationName = organization.Name,
            InvitedUserEmail = invitation.InvitedUserEmail,
            Role = invitation.Role,
            Status = invitation.Status,
            ExpiryUtc = invitation.ExpiryUtc
        };
    }
}