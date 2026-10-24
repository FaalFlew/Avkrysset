using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
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
        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to create issue panels in this organization.", cancellationToken);

        // Panel names are unique within an organization (unique index; was a 500).
        var nameExists = await _context.IssuePanels
            .AnyAsync(p => p.OrganizationId == request.OrganizationId && p.Name == request.Name, cancellationToken);
        if (nameExists)
        {
            throw DuplicateName(request.Name);
        }

        var panel = new IssuePanel
        {
            Name = request.Name,
            OrganizationId = request.OrganizationId
        };

        _context.IssuePanels.Add(panel);
        try
        {
            await _context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (DbErrors.IsUniqueViolation(ex))
        {
            throw DuplicateName(request.Name); // created by someone else at the same moment
        }
        var panelDto = new IssuePanelDto
        {
            Id = panel.Id,
            Name = panel.Name,
            OrganizationId = panel.OrganizationId
        };
        await _notificationService.PanelCreated(request.OrganizationId, panelDto);
        return panelDto;

    }

    public static ConflictException DuplicateName(string name) =>
        new($"An issue panel with the name '{name}' already exists in this organization.");
}