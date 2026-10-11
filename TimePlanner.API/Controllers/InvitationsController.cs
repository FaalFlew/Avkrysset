using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Features.Commands.Organizations;

namespace TimePlanner.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class InvitationsController : ControllerBase
{
    private readonly ISender _mediator;

    public InvitationsController(ISender mediator)
    {
        _mediator = mediator;
    }

    [HttpPost("{token}/accept")]
    [ProducesResponseType(typeof(OrganizationMembershipDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> AcceptInvitation(string token)
    {
        var result = await _mediator.Send(new AcceptInvitationCommand(token));
        return Ok(result);
    }

    [HttpGet("{inviteId:guid}", Name = "GetInvitationById")]
    public async Task<IActionResult> GetInvitationById(Guid inviteId)
    {
        // var query = new GetInvitationByIdQuery(inviteId);
        // var result = await _mediator.Send(query);
        // return Ok(result);
        return Ok(new { Message = "GetInvitationById not fully implemented." }); // Placeholder
    }
}