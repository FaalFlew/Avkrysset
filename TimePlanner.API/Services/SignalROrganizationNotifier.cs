using Microsoft.AspNetCore.SignalR;
using TimePlanner.API.DTOs;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Hubs;

namespace TimePlanner.API.Services;

public class SignalROrganizationNotifier : IOrganizationNotificationService
{
    private readonly IHubContext<OrganizationHub> _hubContext;

    public SignalROrganizationNotifier(IHubContext<OrganizationHub> hubContext)
    {
        _hubContext = hubContext;
    }

    private Task NotifyGroup(Guid organizationId, string method, object payload)
    {
        var groupName = OrganizationHub.GetGroupName(organizationId);
        return _hubContext.Clients.Group(groupName).SendAsync(method, payload);
    }

    // --- Task Notifications ---
    public Task TaskCreated(Guid organizationId, TaskItemDto task) =>
        NotifyGroup(organizationId, "TaskCreated", task);

    public Task TaskUpdated(Guid organizationId, TaskItemDto task) =>
        NotifyGroup(organizationId, "TaskUpdated", task);

    public Task TaskDeleted(Guid organizationId, Guid taskId) =>
        NotifyGroup(organizationId, "TaskDeleted", new { taskId, organizationId });

    // --- Issue Notifications ---
    public Task IssueCreated(Guid organizationId, IssueDto issue) =>
        NotifyGroup(organizationId, "IssueCreated", issue);

    public Task IssueUpdated(Guid organizationId, IssueDto issue) =>
        NotifyGroup(organizationId, "IssueUpdated", issue);

    public Task IssueDeleted(Guid organizationId, Guid panelId, Guid issueId) =>
        NotifyGroup(organizationId, "IssueDeleted", new { issueId, panelId, organizationId });
    public Task OrganizationUpdated(Guid organizationId, OrganizationDto organization) =>
        NotifyGroup(organizationId, "OrganizationUpdated", organization);
    public Task MemberRemoved(Guid organizationId, Guid removedUserId) =>
        NotifyGroup(organizationId, "MemberRemoved", new { organizationId, removedUserId });
    public Task MemberRoleUpdated(Guid organizationId, Guid memberUserId, string newRole) =>
        NotifyGroup(organizationId, "MemberRoleUpdated", new { organizationId, memberUserId, newRole });


    public Task PanelCreated(Guid organizationId, IssuePanelDto panel) => NotifyGroup(organizationId, "PanelCreated", panel);
    public Task PanelUpdated(Guid organizationId, IssuePanelDto panel) => NotifyGroup(organizationId, "PanelUpdated", panel);
    public Task PanelDeleted(Guid organizationId, Guid panelId) => NotifyGroup(organizationId, "PanelDeleted", new { organizationId, panelId });
    public Task IssueMoved(Guid organizationId, Guid issueId, Guid newPanelId) =>
        NotifyGroup(organizationId, "IssueMoved", new { organizationId, issueId, newPanelId });

    public Task MemberJoined(Guid organizationId, OrganizationMembershipDto membership) => NotifyGroup(organizationId, "MemberJoined", membership);
    public Task MemberLeft(Guid organizationId, Guid leftUserId) => NotifyGroup(organizationId, "MemberLeft", new { organizationId, leftUserId });
    public Task OwnershipTransferred(Guid organizationId, Guid newOwnerId, Guid oldOwnerId) => NotifyGroup(organizationId, "OwnershipTransferred", new { organizationId, newOwnerId, oldOwnerId });
    public Task MemberSettingsUpdated(Guid organizationId, OrganizationMembershipDto membership) => NotifyGroup(organizationId, "MemberSettingsUpdated", membership);
}