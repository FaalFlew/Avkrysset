using FluentValidation;
using MediatR;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record CreateIssuePanelCommand(Guid OrganizationId, string Name) : IRequest<IssuePanelDto>;

public class CreateIssuePanelCommandValidator : AbstractValidator<CreateIssuePanelCommand>
{
    public CreateIssuePanelCommandValidator()
    {
        RuleFor(x => x.OrganizationId).NotEmpty();
        RuleFor(x => x.Name).NotEmpty().MaximumLength(100);
    }
}

public class CreateIssuePanelCommandHandler : IRequestHandler<CreateIssuePanelCommand, IssuePanelDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public CreateIssuePanelCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task<IssuePanelDto> Handle(CreateIssuePanelCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Current user must be Admin or Owner.
        if (!await _context.IsAdminOrOwner(currentUserId.Value, request.OrganizationId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You do not have permission to create issue panels in this organization.");
        }

        var panel = new IssuePanel
        {
            Name = request.Name,
            OrganizationId = request.OrganizationId
        };

        _context.IssuePanels.Add(panel);
        await _context.SaveChangesAsync(cancellationToken);
        var panelDto = new IssuePanelDto
        {
            Id = panel.Id,
            Name = panel.Name,
            OrganizationId = panel.OrganizationId
        };
        await _notificationService.PanelCreated(request.OrganizationId, panelDto);
        return panelDto;

    }
}