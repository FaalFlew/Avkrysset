using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
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

        var task = await _context.Tasks
            .Include(t => t.Assignments)
            .FirstOrDefaultAsync(t => t.Id == request.TaskId && t.OrganizationId == request.OrganizationId, cancellationToken);

        if (task == null)
        {
            // Task already deleted, desired state is achieved.
            return;
        }

        // Authorization: User must be Admin/Owner OR the original creator of the task.
        // We'll say only Admins or the creator can delete. Assignees cannot. This is a business rule choice.
        var isCreator = task.UserId == currentUserId;
        var isAdminOrOwner = await _context.IsAdminOrOwner(currentUserId.Value, request.OrganizationId, cancellationToken);

        if (!isCreator && !isAdminOrOwner)
        {
            throw new UnauthorizedAccessException("You do not have permission to delete this task.");
        }

        _context.Tasks.Remove(task); // This will cascade delete the assignments as configured.
        await _context.SaveChangesAsync(cancellationToken);
        await _notificationService.TaskDeleted(request.OrganizationId, request.TaskId);

    }
}