using MediatR;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Utilities;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Services;
using TimePlanner.API.DTOs.Organizations;

namespace TimePlanner.API.Features.Commands.Organizations;

public record UpdateIssuePanelCommand(Guid OrganizationId, Guid PanelId, string Name) : IRequest;

public class UpdateIssuePanelCommandHandler : IRequestHandler<UpdateIssuePanelCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public UpdateIssuePanelCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task Handle(UpdateIssuePanelCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Must be Admin or Owner
        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to edit issue panels.", cancellationToken);

        var panel = await _context.IssuePanels
            .FirstOrDefaultAsync(p => p.Id == request.PanelId && p.OrganizationId == request.OrganizationId, cancellationToken);

        if (panel == null)
        {
            throw new KeyNotFoundException("Issue panel not found.");
        }

        // Check for name uniqueness within the organization
        var nameExists = await _context.IssuePanels
            .AnyAsync(p => p.OrganizationId == request.OrganizationId && p.Name == request.Name && p.Id != request.PanelId, cancellationToken);
        if (nameExists)
        {
            throw new ConflictException($"An issue panel with the name '{request.Name}' already exists in this organization.");
        }

        panel.Name = request.Name;
        await _context.SaveChangesAsync(cancellationToken);

        var panelDto = new IssuePanelDto
        {
            Id = panel.Id,
            Name = panel.Name,
            OrganizationId = panel.OrganizationId
        };
        await _notificationService.PanelUpdated(request.OrganizationId, panelDto);
    }
}