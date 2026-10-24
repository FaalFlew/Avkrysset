using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record CreateIssueCommand(
    Guid OrganizationId,
    Guid PanelId,
    string Title,
    string? Notes,
    Guid CategoryId) : IRequest<IssueDto>;

public class CreateIssueCommandValidator : AbstractValidator<CreateIssueCommand>
{
    public CreateIssueCommandValidator()
    {
        RuleFor(x => x.OrganizationId).NotEmpty();
        RuleFor(x => x.PanelId).NotEmpty();
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
        RuleFor(x => x.CategoryId).NotEmpty();
    }
}

public class CreateIssueCommandHandler : IRequestHandler<CreateIssueCommand, IssueDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT


    public CreateIssueCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task<IssueDto> Handle(CreateIssueCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Current user must be Admin or Owner.
        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to create issues in this organization.", cancellationToken);

        // Validate that the panel exists within the specified organization
        var panelExists = await _context.IssuePanels
            .AnyAsync(p => p.Id == request.PanelId && p.OrganizationId == request.OrganizationId, cancellationToken);
        if (!panelExists)
        {
            throw new KeyNotFoundException("The specified issue panel does not exist in this organization.");
        }

        // Validate the category belongs to the creator
        var category = await _context.Categories.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == request.CategoryId && c.UserId == currentUserId, cancellationToken);
        if (category == null)
        {
            throw new KeyNotFoundException("The specified category was not found for your user.");
        }

        var issue = new Issue
        {
            Title = request.Title,
            Notes = request.Notes,
            CategoryId = request.CategoryId,
            OrganizationId = request.OrganizationId,
            IssuePanelId = request.PanelId
        };

        _context.Issues.Add(issue);
        await _context.SaveChangesAsync(cancellationToken);

        var issueDto = new IssueDto
        {
            Id = issue.Id,
            Title = issue.Title,
            Notes = issue.Notes,
            CategoryId = issue.CategoryId,
            CategoryName = category.Name,
            CategoryColor = category.Color,
            OrganizationId = issue.OrganizationId,
            IssuePanelId = issue.IssuePanelId,
            ConvertedToTaskId = null,
            CreatedOnUtc = issue.CreatedOnUtc
        };

        await _notificationService.IssueCreated(request.OrganizationId, issueDto);

        return issueDto;
    }
}