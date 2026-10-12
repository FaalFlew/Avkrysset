using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record UpdateMemberRoleCommand(Guid OrganizationId, Guid UserId, string NewRole) : IRequest;

public class UpdateMemberRoleCommandValidator : AbstractValidator<UpdateMemberRoleCommand>
{
    public UpdateMemberRoleCommandValidator()
    {
        RuleFor(x => x.NewRole).Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Role is required.")
            .Must(role => role == OrganizationRoles.Admin || role == OrganizationRoles.Member)
            .WithMessage("Role must be either 'Admin' or 'Member'.");
    }
}

public class UpdateMemberRoleCommandHandler : IRequestHandler<UpdateMemberRoleCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public UpdateMemberRoleCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task Handle(UpdateMemberRoleCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Must be an Admin or Owner to change roles.
        var actor = await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to change member roles.", cancellationToken);

        var membershipToUpdate = await _context.OrganizationMemberships
            .FirstOrDefaultAsync(m => m.OrganizationId == request.OrganizationId && m.UserId == request.UserId, cancellationToken);

        if (membershipToUpdate == null)
        {
            throw new KeyNotFoundException("Member not found in this organization.");
        }

        // Business Rule: Cannot change the Owner's role via this endpoint.
        if (membershipToUpdate.Role == OrganizationRoles.Owner)
        {
            throw new BadRequestException("The organization owner's role cannot be changed here. Use 'Transfer ownership' instead.");
        }

        // Business Rule: An Admin cannot demote another Admin if the current user is not the Owner.
        if (membershipToUpdate.Role == OrganizationRoles.Admin && request.NewRole == OrganizationRoles.Member)
        {
            if (actor.Role != OrganizationRoles.Owner)
            {
                throw new ForbiddenException("Only the organization owner can demote an admin.");
            }
        }

        membershipToUpdate.Role = request.NewRole;
        await _context.SaveChangesAsync(cancellationToken);
        await _notificationService.MemberRoleUpdated(request.OrganizationId, request.UserId, request.NewRole);

    }
}