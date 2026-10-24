using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record MoveIssueCommand(Guid OrganizationId, Guid IssueId, Guid NewPanelId) : IRequest;

public class MoveIssueCommandHandler : IRequestHandler<MoveIssueCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public MoveIssueCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT
    }

    public async Task Handle(MoveIssueCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: User must be Admin or Owner to move issues.
        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to move issues in this organization.", cancellationToken);

        // 1. Find the issue to move.
        var issue = await _context.Issues
            .FirstOrDefaultAsync(i => i.Id == request.IssueId && i.OrganizationId == request.OrganizationId, cancellationToken);

        if (issue == null)
        {
            throw new KeyNotFoundException("Issue not found in this organization.");
        }

        // A promoted issue stays where it was (it is read-only, shown only with "Show scheduled").
        if (issue.ConvertedToTaskItemId.HasValue)
        {
            throw new ConflictException("Cannot move an issue that has already been converted to a task.");
        }

        // 2. Validate that the target panel exists within the same organization.
        var targetPanelExists = await _context.IssuePanels
            .AnyAsync(p => p.Id == request.NewPanelId && p.OrganizationId == request.OrganizationId, cancellationToken);

        if (!targetPanelExists)
        {
            throw new KeyNotFoundException("The target issue panel does not exist in this organization.");
        }

        // 3. Perform the move.
        issue.IssuePanelId = request.NewPanelId;
        await _context.SaveChangesAsync(cancellationToken);
        await _notificationService.IssueMoved(request.OrganizationId, request.IssueId, request.NewPanelId);

    }
}