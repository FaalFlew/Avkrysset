using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.DTOs;

namespace TimePlanner.API.Services;

// This interface defines all the real-time events our application can send.
public interface IOrganizationNotificationService
{
    Task TaskCreated(Guid organizationId, TaskItemDto task);
    Task TaskUpdated(Guid organizationId, TaskItemDto task);
    Task TaskDeleted(Guid organizationId, Guid taskId);

    Task IssueCreated(Guid organizationId, IssueDto issue);
    Task IssueUpdated(Guid organizationId, IssueDto issue);
    Task IssueDeleted(Guid organizationId, Guid panelId, Guid issueId);

    Task OrganizationUpdated(Guid organizationId, OrganizationDto organization);
    Task MemberRemoved(Guid organizationId, Guid removedUserId);
    Task MemberRoleUpdated(Guid organizationId, Guid memberUserId, string newRole);

    Task PanelCreated(Guid organizationId, IssuePanelDto panel);
    Task PanelUpdated(Guid organizationId, IssuePanelDto panel);
    Task PanelDeleted(Guid organizationId, Guid panelId);
    Task IssueMoved(Guid organizationId, Guid issueId, Guid newPanelId);
    Task MemberJoined(Guid organizationId, OrganizationMembershipDto membership);
    Task MemberLeft(Guid organizationId, Guid leftUserId);
    Task OwnershipTransferred(Guid organizationId, Guid newOwnerId, Guid oldOwnerId);
    Task MemberSettingsUpdated(Guid organizationId, OrganizationMembershipDto membership);




    // Add other events here as needed, e.g., MemberJoined, PanelCreated, etc.
}