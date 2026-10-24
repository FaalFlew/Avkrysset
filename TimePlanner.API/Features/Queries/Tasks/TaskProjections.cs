using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Models;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Tasks;

/// <summary>
/// One SQL projection from <see cref="TaskItem"/> to <see cref="TaskItemDto"/> (organization name,
/// assignees and creator with display names), shared by personal and organization endpoints.
/// <see cref="TaskItemDto.Capabilities"/> depends on who is asking, so callers fill it in with
/// <see cref="TaskCapabilities"/>.
/// </summary>
public static class TaskProjections
{
    public static readonly Expression<Func<TaskItem, TaskItemDto>> ToDto = t => new TaskItemDto
    {
        Id = t.Id,
        OrganizationId = t.OrganizationId,
        OrganizationName = t.Organization != null ? t.Organization.Name : null,
        Title = t.Title,
        Start = t.Start,
        Duration = t.Duration,
        CategoryId = t.CategoryId,
        CategoryName = t.Category.Name,
        CategoryColor = t.Category.Color,
        TemplateId = t.TemplateId,
        Assignees = t.Assignments
            .OrderBy(a => a.Assignee.DisplayName ?? a.Assignee.Email)
            .Select(a => new TaskAssigneeDto
            {
                UserId = a.AssigneeId,
                DisplayName = a.Assignee.DisplayName ?? a.Assignee.Email!,
                Email = a.Assignee.Email!
            })
            .ToList(),
        CreatedBy = new TaskCreatorDto
        {
            UserId = t.UserId,
            DisplayName = t.User.DisplayName ?? t.User.Email!
        }
    };

    /// <summary>Loads one task as a DTO in a single query (capabilities left empty).</summary>
    public static Task<TaskItemDto> LoadAsync(ApplicationDbContext context, Guid taskId, CancellationToken cancellationToken) =>
        context.Tasks.AsNoTracking().Where(t => t.Id == taskId).Select(ToDto).SingleAsync(cancellationToken);

    /// <summary>The viewer's role in each organization where their membership is active.</summary>
    public static Task<Dictionary<Guid, string>> ActiveRolesAsync(
        ApplicationDbContext context, Guid userId, CancellationToken cancellationToken) =>
        context.OrganizationMemberships
            .AsNoTracking()
            .Where(m => m.UserId == userId && m.Status == MembershipStatus.Active)
            .ToDictionaryAsync(m => m.OrganizationId, m => m.Role, cancellationToken);

    /// <summary>Fills <see cref="TaskItemDto.Capabilities"/> for <paramref name="viewerId"/>.</summary>
    public static void ApplyCapabilities(IEnumerable<TaskItemDto> tasks, Guid viewerId, IReadOnlyDictionary<Guid, string> rolesByOrganization)
    {
        foreach (var task in tasks)
        {
            string? role = null;
            if (task.OrganizationId is Guid organizationId)
            {
                rolesByOrganization.TryGetValue(organizationId, out role);
            }

            task.Capabilities = TaskCapabilities.For(task.OrganizationId, task.CreatedBy.UserId, viewerId, role);
        }
    }
}

/// <summary>
/// What a user may do with a task. The same rules are enforced by the organization task
/// update/delete/assignee handlers.
/// - Personal task (only its owner ever sees it): edit and delete; there is nobody to reassign to.
/// - Organization task, viewer is Owner/Admin: edit, delete, reassign.
/// - Organization task a member created (for themselves): edit and delete, not reassign.
/// - Organization task a member was only assigned: read-only.
/// </summary>
public static class TaskCapabilities
{
    public static TaskCapabilitiesDto For(Guid? organizationId, Guid creatorId, Guid viewerId, string? viewerRole)
    {
        if (organizationId is null)
        {
            return new TaskCapabilitiesDto { CanEdit = true, CanDelete = true, CanReassign = false };
        }

        if (AuthorizationExtensions.IsAdminOrOwnerRole(viewerRole))
        {
            return new TaskCapabilitiesDto { CanEdit = true, CanDelete = true, CanReassign = true };
        }

        if (viewerRole == OrganizationRoles.Member && creatorId == viewerId)
        {
            return new TaskCapabilitiesDto { CanEdit = true, CanDelete = true, CanReassign = false };
        }

        return new TaskCapabilitiesDto { CanEdit = false, CanDelete = false, CanReassign = false };
    }
}
