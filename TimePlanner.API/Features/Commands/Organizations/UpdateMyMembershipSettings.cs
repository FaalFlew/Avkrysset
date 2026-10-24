
using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using TimePlanner.API.Data;
using TimePlanner.API.Features.Queries.Organizations;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

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

        // Only active members (others get 404 "Organization not found.").
        var activeMembership = await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);
        var membership = await _context.OrganizationMemberships
            .SingleAsync(m => m.Id == activeMembership.Id, cancellationToken);

        membership.StatusMessage = request.StatusMessage;
        await _context.SaveChangesAsync(cancellationToken);

        var membershipDto = await MembershipProjections.LoadAsync(_context, membership.Id, cancellationToken);

        await _notificationService.MemberSettingsUpdated(request.OrganizationId, membershipDto);
    }
}