using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Tasks;

public record DeleteTaskCommand(Guid Id) : IRequest;

public class DeleteTaskCommandHandler : IRequestHandler<DeleteTaskCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public DeleteTaskCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task Handle(DeleteTaskCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        // Only personal tasks: organization tasks are deleted through the organization endpoints.
        var task = await _context.Tasks
            .FirstOrDefaultAsync(t => t.Id == request.Id && t.UserId == userId && t.OrganizationId == null, cancellationToken);

        if (task != null)
        {

            task.IsDeleted = true;

            await _context.SaveChangesAsync(cancellationToken);
        }
        // If not found, do nothing.
    }
}