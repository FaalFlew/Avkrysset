using MediatR;
using Microsoft.EntityFrameworkCore;
using Api.Data;
using Api.Services;

namespace Api.Features.Commands.TaskTemplates;

public record DeleteTaskTemplateCommand(Guid Id) : IRequest;

public class DeleteTaskTemplateCommandHandler : IRequestHandler<DeleteTaskTemplateCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public DeleteTaskTemplateCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task Handle(DeleteTaskTemplateCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        var template = await _context.TaskTemplates
            .FirstOrDefaultAsync(tt => tt.Id == request.Id && tt.UserId == userId, cancellationToken);

        if (template != null)
        {
            _context.TaskTemplates.Remove(template);
            await _context.SaveChangesAsync(cancellationToken);
        }
    }
}