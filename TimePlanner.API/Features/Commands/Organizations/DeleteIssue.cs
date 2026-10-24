using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record DeleteIssueCommand(Guid OrganizationId, Guid PanelId, Guid IssueId) : IRequest;

public class DeleteIssueCommandHandler : IRequestHandler<DeleteIssueCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public DeleteIssueCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task Handle(DeleteIssueCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: User must be Admin or Owner.
        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to delete issues in this organization.", cancellationToken);

        // Scoped to the organization in the route (whose admin rights were just checked): looking the issue up by
        // panel and id alone let an admin of one organization delete another organization's issues.
        var issue = await _context.Issues
            .FirstOrDefaultAsync(i => i.Id == request.IssueId && i.OrganizationId == request.OrganizationId, cancellationToken)
            ?? throw new KeyNotFoundException("Issue not found in this organization.");

        if (issue.ConvertedToTaskItemId.HasValue)
        {
            throw new ConflictException("Cannot delete an issue that has already been converted to a task. Delete the task instead.");
        }

        _context.Issues.Remove(issue);
        await _context.SaveChangesAsync(cancellationToken);
        // The issue's actual panel (it may have been moved since the client loaded the board).
        await _notificationService.IssueDeleted(request.OrganizationId, issue.IssuePanelId, request.IssueId);

    }
}