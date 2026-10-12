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

        var issue = await _context.Issues
            .FirstOrDefaultAsync(i => i.Id == request.IssueId && i.IssuePanelId == request.PanelId, cancellationToken);

        if (issue == null)
        {
            // Issue already deleted, desired state is achieved.
            return;
        }

        if (issue.ConvertedToTaskItemId.HasValue)
        {
            throw new ConflictException("Cannot delete an issue that has already been converted to a task. Delete the task instead.");
        }

        _context.Issues.Remove(issue);
        await _context.SaveChangesAsync(cancellationToken);
        await _notificationService.IssueDeleted(request.OrganizationId, request.PanelId, request.IssueId);

    }
}