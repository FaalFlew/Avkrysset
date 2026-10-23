using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record UpdateOrganizationCommand(Guid OrganizationId, string Name) : IRequest;

public class UpdateOrganizationCommandValidator : AbstractValidator<UpdateOrganizationCommand>
{
    public UpdateOrganizationCommandValidator()
    {
        RuleFor(x => x.OrganizationId).NotEmpty();
        RuleFor(x => x.Name).NotEmpty().MaximumLength(150);
    }
}

public class UpdateOrganizationCommandHandler : IRequestHandler<UpdateOrganizationCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT

    public UpdateOrganizationCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task Handle(UpdateOrganizationCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: User must be an Admin or Owner.
        if (!await _context.IsAdminOrOwner(currentUserId.Value, request.OrganizationId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You do not have permission to edit this organization's settings.");
        }

        var organization = await _context.Organizations
            .FirstOrDefaultAsync(o => o.Id == request.OrganizationId, cancellationToken);

        if (organization == null)
        {
            throw new KeyNotFoundException("Organization not found.");
        }

        // Business Rule: Check if the new name is already taken by another organization.
        var nameExists = await _context.Organizations
            .AnyAsync(o => o.Name == request.Name && o.Id != request.OrganizationId, cancellationToken);
        if (nameExists)
        {
            throw new ConflictException($"An organization with the name '{request.Name}' already exists.");
        }

        organization.Name = request.Name;
        // The UpdatedOnUtc/UpdatedByUserId will be set by the DbContext's SaveChangesAsync override.

        await _context.SaveChangesAsync(cancellationToken);
        var orgDto = new OrganizationDto
        {
            Id = organization.Id,
            Name = organization.Name,
            OwnerId = organization.OwnerId
        };
        await _notificationService.OrganizationUpdated(request.OrganizationId, orgDto);
    }
}