using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TimePlanner.API.DTOs;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Features.Queries.Users;

namespace TimePlanner.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UsersController : ControllerBase
{
    private readonly ISender _mediator;

    public UsersController(ISender mediator)
    {
        _mediator = mediator;
    }

    [HttpGet("me/organizations")]
    [ProducesResponseType(typeof(List<OrganizationDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetMyOrganizations()
    {
        var query = new GetMyOrganizationsQuery();
        var result = await _mediator.Send(query);
        return Ok(result);
    }

    [HttpGet("me/tasks/organization")]
    [ProducesResponseType(typeof(List<TaskItemDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetMyOrganizationTasks([FromQuery] DateTime startDate, [FromQuery] DateTime endDate)
    {
        if (startDate >= endDate)
        {
            return BadRequest("The start date must be before the end date.");
        }

        var query = new GetMyOrganizationTasksQuery(startDate, endDate);
        var result = await _mediator.Send(query);
        return Ok(result);
    }


    [HttpGet("me/invitations")]
    [ProducesResponseType(typeof(List<OrganizationInvitationDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> GetMyInvitations()
    {
        var result = await _mediator.Send(new GetMyInvitationsQuery());
        return Ok(result);
    }
}