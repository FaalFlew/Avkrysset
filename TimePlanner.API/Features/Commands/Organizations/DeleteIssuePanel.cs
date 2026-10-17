using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record DeleteIssuePanelCommand(Guid OrganizationId, Guid PanelId) : IRequest;

public class DeleteIssuePanelCommandHandler : IRequestHandler<DeleteIssuePanelCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public DeleteIssuePanelCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task Handle(DeleteIssuePanelCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Must be Admin or Owner
        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to delete issue panels.", cancellationToken);

        var panel = await _context.IssuePanels
            .FirstOrDefaultAsync(p => p.Id == request.PanelId && p.OrganizationId == request.OrganizationId, cancellationToken);

        if (panel != null)
        {
            // Deleting the panel will cascade delete all issues within it, as configured in the DbContext.
            _context.IssuePanels.Remove(panel);
            await _context.SaveChangesAsync(cancellationToken);
            await _notificationService.PanelDeleted(request.OrganizationId, request.PanelId);
        }
    }
}