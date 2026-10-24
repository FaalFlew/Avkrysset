using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Features.Queries.Organizations;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

public record UpdateIssueCommand(
    Guid OrganizationId,
    Guid PanelId, // Kept for route consistency
    Guid IssueId,
    string Title,
    string? Notes,
    Guid CategoryId) : IRequest;

public class UpdateIssueCommandValidator : AbstractValidator<UpdateIssueCommand>
{
    public UpdateIssueCommandValidator()
    {
        RuleFor(x => x.OrganizationId).NotEmpty();
        RuleFor(x => x.PanelId).NotEmpty();
        RuleFor(x => x.IssueId).NotEmpty();
        RuleFor(x => x.Title).NotEmpty().MaximumLength(200);
        RuleFor(x => x.CategoryId).NotEmpty();
    }
}

public class UpdateIssueCommandHandler : IRequestHandler<UpdateIssueCommand>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly IOrganizationNotificationService _notificationService; // INJECT

    public UpdateIssueCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService,
        IOrganizationNotificationService notificationService)
    {
        _context = context;
        _currentUserService = currentUserService;
        _notificationService = notificationService; // INJECT

    }

    public async Task Handle(UpdateIssueCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: User must be Admin or Owner.
        await _context.RequireAdminOrOwner(currentUserId.Value, request.OrganizationId, "You do not have permission to edit issues in this organization.", cancellationToken);

        var issue = await _context.Issues
            .FirstOrDefaultAsync(i => i.Id == request.IssueId && i.OrganizationId == request.OrganizationId, cancellationToken);

        if (issue == null)
        {
            throw new KeyNotFoundException("Issue not found in this organization.");
        }

        // Ensure the issue is still in the panel specified by the route, for consistency.
        if (issue.IssuePanelId != request.PanelId)
        {
            // This is an edge case, but good to handle. Maybe the issue was moved.
            throw new ConflictException("This issue is no longer in the specified panel.");
        }

        if (issue.ConvertedToTaskItemId.HasValue)
        {
            throw new ConflictException("Cannot edit an issue that has already been converted to a task.");
        }

        // Categories are personal. Keeping the issue's current category (which may belong to the admin who created
        // it) is always allowed; choosing a different one requires one of the editor's own categories (decision Q2).
        if (request.CategoryId != issue.CategoryId)
        {
            var categoryExists = await _context.Categories.AnyAsync(c => c.Id == request.CategoryId && c.UserId == currentUserId, cancellationToken);
            if (!categoryExists)
            {
                throw new ValidationException("The specified category was not found for your user.");
            }
        }

        issue.Title = request.Title;
        issue.Notes = request.Notes;
        issue.CategoryId = request.CategoryId;

        await _context.SaveChangesAsync(cancellationToken);

        await _notificationService.IssueUpdated(request.OrganizationId, await IssueProjections.LoadAsync(_context, issue.Id, cancellationToken));
    }
}