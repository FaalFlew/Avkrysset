using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record DeleteOrganizationTaskCommand(Guid OrganizationId, Guid TaskId) : IRequest;

public class DeleteOrganizationTaskCommandHandler : IRequestHandler<DeleteOrganizationTaskCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public DeleteOrganizationTaskCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService;
    }

    public async Task Handle(DeleteOrganizationTaskCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        var membership = await _context.RequireActiveMember(currentUserId.Value, request.OrganizationId, cancellationToken);

        var task = await _context.Tasks
            .Include(t => t.Assignments)
            .FirstOrDefaultAsync(t => t.Id == request.TaskId && t.OrganizationId == request.OrganizationId, cancellationToken);

        if (task == null)
        {
            // Task already deleted, desired state is achieved.
            return;
        }

        // Authorization: Admins/Owners, or the member who created the task. Assignees cannot delete.
        if (!TaskCapabilities.For(task.OrganizationId, task.UserId, currentUserId.Value, membership.Role).CanDelete)
        {
            throw new ForbiddenException("Only an organization admin or the task's creator can delete this task.");
        }

        _context.Tasks.Remove(task); // This will cascade delete the assignments as configured.
        await _context.SaveChangesAsync(cancellationToken);
        await _notificationService.TaskDeleted(request.OrganizationId, request.TaskId);

    }
}