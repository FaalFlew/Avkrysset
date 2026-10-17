using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TimePlanner.API.DTOs;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Commands.Organizations;
using TimePlanner.API.Features.Queries.Organizations;
using TimePlanner.API.Features.Queries.Users;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class OrganizationsController : ControllerBase
{
    private readonly ISender _mediator;

    public OrganizationsController(ISender mediator)
    {
        _mediator = mediator;
    }

    [HttpPost]
    [ProducesResponseType(typeof(OrganizationDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> CreateOrganization(CreateOrganizationCommand command)
    {
        // Without an explicit timeZoneId the organization uses the creator's zone (X-Time-Zone header);
        // a missing or unknown header gives UTC. An explicit but unknown timeZoneId is rejected (400).
        if (string.IsNullOrWhiteSpace(command.TimeZoneId))
        {
            var headerZone = ClientTimeZone.GetId(Request);
            command = command with { TimeZoneId = ClientTimeZone.IsKnown(headerZone) ? headerZone : "UTC" };
        }

        var result = await _mediator.Send(command);
        // Returns a 201 Created status with a Location header pointing to where the new resource can be fetched.
        // We will create the "GetOrganizationById" endpoint later.
        return CreatedAtAction("GetOrganizationById", new { organizationId = result.Id }, result);
    }

    // This replaces the old stub implementation
    [HttpGet("{organizationId:guid}", Name = "GetOrganizationById")] // Keep the Name for CreatedAtAction
    [ProducesResponseType(typeof(OrganizationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetOrganizationById(Guid organizationId)
    {
        var query = new GetOrganizationByIdQuery(organizationId);
        var result = await _mediator.Send(query);
        return Ok(result);
    }

    [HttpPost("join")]
    [ProducesResponseType(typeof(OrganizationMembershipDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)] // For validation errors (e.g., bad code format)
    [ProducesResponseType(StatusCodes.Status404NotFound)] // For invalid join code
    [ProducesResponseType(StatusCodes.Status409Conflict)] // For already a member
    public async Task<IActionResult> JoinOrganization(JoinOrganizationCommand command)
    {
        var result = await _mediator.Send(command);
        return Ok(result);
    }

    [HttpGet("{organizationId:guid}/members")]
    [ProducesResponseType(typeof(List<OrganizationMembershipDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)] // We can throw a specific exception for this
    public async Task<IActionResult> GetOrganizationMembers(Guid organizationId)
    {
        var query = new GetOrganizationMembersQuery(organizationId);
        var result = await _mediator.Send(query);
        return Ok(result);
    }

    [HttpDelete("{organizationId:guid}/members/{userId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)] // For trying to remove owner
    public async Task<IActionResult> RemoveMember(Guid organizationId, Guid userId, [FromQuery] bool hardDeleteTasks = false)
    {
        var command = new RemoveMemberCommand(organizationId, userId, hardDeleteTasks);
        await _mediator.Send(command);
        return NoContent();
    }

    [HttpPut("{organizationId:guid}/members/{userId:guid}/role")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateMemberRole(Guid organizationId, Guid userId, [FromBody] UpdateMemberRoleCommand command)
    {
        // Ensure the route parameters match the command parameters for consistency.
        if (organizationId != command.OrganizationId || userId != command.UserId)
        {
            throw new BadRequestException("Route parameters must match the request body.");
        }

        await _mediator.Send(command);
        return NoContent();
    }

    [HttpPost("{organizationId:guid}/tasks")]
    [ProducesResponseType(typeof(TaskItemDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CreateOrganizationTask(Guid organizationId, [FromBody] CreateOrganizationTaskCommand command)
    {
        if (organizationId != command.OrganizationId)
        {
            throw new BadRequestException("Route parameter 'organizationId' must match the command body.");
        }

        var result = await _mediator.Send(command);
        return CreatedAtAction("GetOrganizationTaskById", new { organizationId = result.OrganizationId, taskId = result.Id }, result);
    }

    // --- ADD THIS NEW ENDPOINT for Members assigning to THEMSELVES ---
    [HttpPost("{organizationId:guid}/tasks/personal")]
    [ProducesResponseType(typeof(TaskItemDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CreatePersonalOrganizationTask(Guid organizationId, [FromBody] CreatePersonalOrganizationTaskCommand command)
    {
        if (organizationId != command.OrganizationId)
        {
            throw new BadRequestException("Route parameter 'organizationId' must match the command body.");
        }

        var result = await _mediator.Send(command);
        // We can reuse the same CreatedAtAction target as the admin endpoint.
        return CreatedAtAction("GetOrganizationTaskById", new { organizationId = result.OrganizationId, taskId = result.Id }, result);
    }

    // Add a stub for the CreatedAtAction
    [HttpGet("{organizationId:guid}/tasks/{taskId:guid}")]
    public IActionResult GetOrganizationTaskById(Guid organizationId, Guid taskId)
    {
        // We will implement this properly in a future step.
        return Ok(new { Message = $"Endpoint for task {taskId} in organization {organizationId} not implemented yet." });
    }

    [HttpPost("{organizationId:guid}/issue-panels")]
    [ProducesResponseType(typeof(IssuePanelDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> CreateIssuePanel(Guid organizationId, [FromBody] CreateIssuePanelCommand command)
    {
        if (organizationId != command.OrganizationId)
        {
            throw new BadRequestException("Route parameter 'organizationId' must match the command body.");
        }

        var result = await _mediator.Send(command);
        return CreatedAtAction("GetIssuePanelById", new { organizationId = result.OrganizationId, panelId = result.Id }, result);
    }


    [HttpPost("{organizationId:guid}/issue-panels/{panelId:guid}/issues")]
    [ProducesResponseType(typeof(IssueDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> CreateIssue(Guid organizationId, Guid panelId, [FromBody] CreateIssueCommand command)
    {
        if (organizationId != command.OrganizationId || panelId != command.PanelId)
        {
            throw new BadRequestException("Route parameters must match the command body.");
        }

        var result = await _mediator.Send(command);
        // Location header points to a future GetIssueById endpoint.
        return CreatedAtAction("GetIssueById", new { organizationId, panelId, issueId = result.Id }, result);
    }


    // This replaces the stub [HttpGet("{organizationId:guid}/issue-panels/{panelId:guid}")]
    [HttpGet("{organizationId:guid}/issue-panels")]
    [ProducesResponseType(typeof(List<IssuePanelDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetOrganizationIssuePanels(Guid organizationId)
    {
        var query = new GetOrganizationIssuePanelsQuery(organizationId);
        var result = await _mediator.Send(query);
        return Ok(result);
    }


    // --- We can also now implement the specific GetIssuePanelById endpoint ---

    [HttpGet("{organizationId:guid}/issue-panels/{panelId:guid}", Name = "GetIssuePanelById")]
    [ProducesResponseType(typeof(IssuePanelDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetIssuePanelById(Guid organizationId, Guid panelId)
    {
        // For simplicity, we can create the query inline here. In a larger app, it would be its own file.
        var query = new GetOrganizationIssuePanelsQuery(organizationId); // Reuse auth logic
        var panels = await _mediator.Send(query);
        var panel = panels.FirstOrDefault(p => p.Id == panelId);

        if (panel == null)
        {
            return NotFound();
        }

        return Ok(panel);
    }

    [HttpGet("{organizationId:guid}/issue-panels/{panelId:guid}/issues")]
    [ProducesResponseType(typeof(List<IssueDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetPanelIssues(Guid organizationId, Guid panelId)
    {
        var query = new GetPanelIssuesQuery(organizationId, panelId);
        var result = await _mediator.Send(query);
        return Ok(result);
    }

    // We can also implement the specific GetIssueById now
    [HttpGet("{organizationId:guid}/issue-panels/{panelId:guid}/issues/{issueId:guid}", Name = "GetIssueById")]
    [ProducesResponseType(typeof(IssueDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetIssueById(Guid organizationId, Guid panelId, Guid issueId)
    {
        // Reuse the auth logic from the list query
        var query = new GetPanelIssuesQuery(organizationId, panelId);
        var issues = await _mediator.Send(query);
        var issue = issues.FirstOrDefault(i => i.Id == issueId);

        if (issue == null)
        {
            return NotFound();
        }

        return Ok(issue);
    }

    [HttpPost("{organizationId:guid}/issues/{issueId:guid}/promote-to-task")]
    [ProducesResponseType(typeof(TaskItemDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> PromoteIssueToTask(Guid organizationId, Guid issueId, [FromBody] PromoteIssueToTaskCommand command)
    {
        // Ensure route parameters match the command body for consistency and security.
        if (organizationId != command.OrganizationId || issueId != command.IssueId)
        {
            throw new BadRequestException("Route parameters must match the request body.");
        }

        var result = await _mediator.Send(command);

        // After promoting, the new resource is a Task, so we point to the GetOrganizationTaskById endpoint.
        return CreatedAtAction("GetOrganizationTaskById", new { organizationId = result.OrganizationId, taskId = result.Id }, result);
    }

    [HttpPost("{organizationId:guid}/transfer-ownership")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> TransferOwnership(Guid organizationId, [FromBody] TransferOwnershipCommand command)
    {
        if (organizationId != command.OrganizationId)
        {
            throw new BadRequestException("Route parameter 'organizationId' must match the command body.");
        }

        await _mediator.Send(command);
        return NoContent();
    }

    [HttpPost("{organizationId:guid}/regenerate-codes")]
    [ProducesResponseType(typeof(OrganizationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> RegenerateJoinCodes(Guid organizationId, [FromBody] RegenerateJoinCodesCommand command)
    {
        if (organizationId != command.OrganizationId)
        {
            throw new BadRequestException("Route parameter 'organizationId' must match the command body.");
        }

        var result = await _mediator.Send(command);
        return Ok(result);
    }

    [HttpDelete("{organizationId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> DeleteOrganization(Guid organizationId)
    {
        var command = new DeleteOrganizationCommand(organizationId);
        await _mediator.Send(command);
        return NoContent();
    }

    [HttpGet("{organizationId:guid}/analytics")]
    [ProducesResponseType(typeof(OrganizationAnalyticsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetOrganizationAnalytics(
        [FromRoute] Guid organizationId,
        [FromQuery] DateTime startDate,
        [FromQuery] DateTime endDate)
    {
        if (startDate >= endDate)
        {
            throw new BadRequestException("The start date must be before the end date.");
        }

        var query = new GetOrganizationAnalyticsQuery(organizationId, startDate, endDate);
        var result = await _mediator.Send(query);
        return Ok(result);
    }


    [HttpPost("{organizationId:guid}/members/me/leave")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)] // For owner trying to leave
    public async Task<IActionResult> LeaveOrganization(Guid organizationId)
    {
        var command = new LeaveOrganizationCommand(organizationId);
        await _mediator.Send(command);
        return NoContent();
    }

    [HttpPut("{organizationId:guid}/tasks/{taskId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateOrganizationTask(Guid organizationId, Guid taskId, [FromBody] UpdateOrganizationTaskCommand command)
    {
        if (organizationId != command.OrganizationId || taskId != command.TaskId)
        {
            throw new BadRequestException("Route parameters must match the command body.");
        }

        await _mediator.Send(command);
        return NoContent();
    }

    [HttpDelete("{organizationId:guid}/tasks/{taskId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> DeleteOrganizationTask(Guid organizationId, Guid taskId)
    {
        var command = new DeleteOrganizationTaskCommand(organizationId, taskId);
        await _mediator.Send(command);
        return NoContent();
    }


    [HttpPut("{organizationId:guid}/issue-panels/{panelId:guid}/issues/{issueId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> UpdateIssue(Guid organizationId, Guid panelId, Guid issueId, [FromBody] UpdateIssueCommand command)
    {
        if (organizationId != command.OrganizationId || panelId != command.PanelId || issueId != command.IssueId)
        {
            throw new BadRequestException("Route parameters must match the command body.");
        }

        await _mediator.Send(command);
        return NoContent();
    }

    [HttpDelete("{organizationId:guid}/issue-panels/{panelId:guid}/issues/{issueId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> DeleteIssue(Guid organizationId, Guid panelId, Guid issueId)
    {
        var command = new DeleteIssueCommand(organizationId, panelId, issueId);
        await _mediator.Send(command);
        return NoContent();
    }

    [HttpGet("{organizationId:guid}/tasks")]
    [ProducesResponseType(typeof(List<TaskItemDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetOrganizationTasks(
    [FromRoute] Guid organizationId,
    [FromQuery] DateTime startDate,
    [FromQuery] DateTime endDate,
    [FromQuery] Guid? memberId = null) // Optional memberId filter
    {
        if (startDate >= endDate)
        {
            throw new BadRequestException("The start date must be before the end date.");
        }

        var query = new GetOrganizationTasksQuery(organizationId, startDate, endDate, memberId);
        var result = await _mediator.Send(query);
        return Ok(result);
    }

    [HttpGet("{organizationId:guid}/issue-board")]
    [ProducesResponseType(typeof(IssueBoardDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetIssueBoard(Guid organizationId)
    {
        var query = new GetIssueBoardQuery(organizationId);
        var result = await _mediator.Send(query);
        return Ok(result);
    }

    [HttpGet("{organizationId:guid}/join-codes")]
    [ProducesResponseType(typeof(JoinCodesDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetJoinCodes(Guid organizationId)
    {
        var query = new GetJoinCodesQuery(organizationId);
        var result = await _mediator.Send(query);
        return Ok(result);
    }

    [HttpPut("{organizationId:guid}/tasks/{taskId:guid}/assignees")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateTaskAssignees(Guid organizationId, Guid taskId, [FromBody] UpdateTaskAssigneesCommand command)
    {
        if (organizationId != command.OrganizationId || taskId != command.TaskId)
        {
            throw new BadRequestException("Route parameters must match the command body.");
        }

        await _mediator.Send(command);
        return NoContent();
    }

    [HttpGet("{organizationId:guid}/analytics/members/{memberId:guid}")]
    [ProducesResponseType(typeof(MemberAnalyticsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetMemberAnalytics(
    [FromRoute] Guid organizationId,
    [FromRoute] Guid memberId,
    [FromQuery] DateTime startDate,
    [FromQuery] DateTime endDate)
    {
        if (startDate >= endDate)
        {
            throw new BadRequestException("The start date must be before the end date.");
        }

        var query = new GetMemberAnalyticsQuery(organizationId, memberId, startDate, endDate);
        var result = await _mediator.Send(query);
        return Ok(result);
    }


    [HttpPut("{organizationId:guid}/issue-panels/{panelId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateIssuePanel(Guid organizationId, Guid panelId, [FromBody] UpdateIssuePanelCommand command)
    {
        if (organizationId != command.OrganizationId || panelId != command.PanelId)
        {
            throw new BadRequestException("Route parameters must match the command body.");
        }
        await _mediator.Send(command);
        return NoContent();
    }

    [HttpDelete("{organizationId:guid}/issue-panels/{panelId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> DeleteIssuePanel(Guid organizationId, Guid panelId)
    {
        var command = new DeleteIssuePanelCommand(organizationId, panelId);
        await _mediator.Send(command);
        return NoContent();
    }

    [HttpPut("{organizationId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> UpdateOrganization(Guid organizationId, [FromBody] UpdateOrganizationCommand command)
    {
        if (organizationId != command.OrganizationId)
        {
            throw new BadRequestException("Route parameter 'organizationId' must match the command body.");
        }

        await _mediator.Send(command);
        return NoContent();
    }

    [HttpGet("{organizationId:guid}/members/me")]
    [ProducesResponseType(typeof(OrganizationMembershipDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetMyMembership(Guid organizationId)
    {
        var query = new GetMyMembershipQuery(organizationId);
        var result = await _mediator.Send(query);
        return Ok(result);
    }


    [HttpPut("{organizationId:guid}/issues/{issueId:guid}/move")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> MoveIssue(Guid organizationId, Guid issueId, [FromBody] MoveIssueCommand command)
    {
        if (organizationId != command.OrganizationId || issueId != command.IssueId)
        {
            throw new BadRequestException("Route parameters must match the command body.");
        }

        await _mediator.Send(command);
        return NoContent();
    }

    [HttpGet("{organizationId:guid}/members/selectable")]
    [ProducesResponseType(typeof(List<SelectableMemberDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetSelectableMembers(Guid organizationId)
    {
        var query = new GetSelectableMembersQuery(organizationId);
        var result = await _mediator.Send(query);
        return Ok(result);
    }

    [HttpGet("{organizationId:guid}/activity")]
    [ProducesResponseType(typeof(List<ActivityLogDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public async Task<IActionResult> GetOrganizationActivity(Guid organizationId, [FromQuery] int limit = 50)
    {
        var query = new GetOrganizationActivityQuery(organizationId, limit);
        var result = await _mediator.Send(query);
        return Ok(result);
    }

    [HttpPut("{organizationId:guid}/members/me/settings")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateMyMembershipSettings(Guid organizationId, [FromBody] UpdateMyMembershipSettingsCommand command)
    {
        if (organizationId != command.OrganizationId)
        {
            throw new BadRequestException("Route parameter 'organizationId' must match the command body.");
        }

        await _mediator.Send(command);
        return NoContent();
    }
    [HttpPost("{organizationId:guid}/invitations")]
    [ProducesResponseType(typeof(OrganizationInvitationDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> InviteUser(Guid organizationId, [FromBody] InviteUserCommand command)
    {
        if (organizationId != command.OrganizationId)
        {
            throw new BadRequestException("Route parameter 'organizationId' must match the command body.");
        }

        var result = await _mediator.Send(command);
        return CreatedAtAction(
            actionName: "GetInvitationById",
            controllerName: "Invitations", // Specify the controller name (without the "Controller" suffix)
            routeValues: new { inviteId = result.Id },
            value: result);
    }
}