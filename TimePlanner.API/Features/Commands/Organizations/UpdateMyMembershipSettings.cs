
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Organizations;

public record UpdateMyMembershipSettingsCommand(
    Guid OrganizationId,
    string? StatusMessage) : IRequest;

public class UpdateMyMembershipSettingsCommandValidator : AbstractValidator<UpdateMyMembershipSettingsCommand>
{
    public UpdateMyMembershipSettingsCommandValidator()
    {
        RuleFor(x => x.OrganizationId).NotEmpty();

        RuleFor(x => x.StatusMessage).MaximumLength(150);
    }
}

public class UpdateMyMembershipSettingsCommandHandler : IRequestHandler<UpdateMyMembershipSettingsCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public UpdateMyMembershipSettingsCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task Handle(UpdateMyMembershipSettingsCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        var membership = await _context.OrganizationMemberships
            .FirstOrDefaultAsync(m => m.OrganizationId == request.OrganizationId && m.UserId == currentUserId, cancellationToken);

        if (membership == null)
        {
            throw new KeyNotFoundException("You are not a member of this organization.");
        }

        membership.StatusMessage = request.StatusMessage;
        await _context.SaveChangesAsync(cancellationToken);

        var membershipDto = await _context.OrganizationMemberships.AsNoTracking()
        .Where(m => m.Id == membership.Id)
        .Select(m => new OrganizationMembershipDto
        {
            MembershipId = m.Id,
            OrganizationId = m.OrganizationId,
            OrganizationName = m.Organization.Name,
            UserId = m.UserId,
            UserEmail = m.User.Email!,
            Role = m.Role,
            Status = m.Status,
            StatusMessage = m.StatusMessage // Include the newly updated message
        })
        .SingleAsync(cancellationToken);

        await _notificationService.MemberSettingsUpdated(request.OrganizationId, membershipDto);
    }
}