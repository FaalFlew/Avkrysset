using MediatR;
using TimePlanner.API.Data;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record DeleteOrganizationCommand(Guid OrganizationId) : IRequest;

public class DeleteOrganizationCommandHandler : IRequestHandler<DeleteOrganizationCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<DeleteOrganizationCommandHandler> _logger;

    public DeleteOrganizationCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService, ILogger<DeleteOrganizationCommandHandler> logger)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
    }

    public async Task Handle(DeleteOrganizationCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Only the owner can delete the organization.
        await _context.RequireOwner(currentUserId.Value, request.OrganizationId, "Only the organization owner can delete the organization.", cancellationToken);

        var organization = await _context.Organizations.FindAsync(new object[] { request.OrganizationId }, cancellationToken);
        if (organization == null)
        {
            // Organization already deleted, so the desired state is achieved.
            return;
        }

        _context.Organizations.Remove(organization);
        await _context.SaveChangesAsync(cancellationToken);

        _logger.LogWarning("Organization {OrganizationId} and all its associated data has been permanently deleted by Owner {UserId}.",
            request.OrganizationId, currentUserId);
    }
}