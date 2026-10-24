using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Features.Commands.Organizations;
using TimePlanner.API.Features.Queries.Organizations;

namespace TimePlanner.API.Controllers;

/// <summary>
/// Invitations addressed by id (the signed-in invitee's inbox, or an Owner/Admin) or by the email link's token.
/// Tokens are 43-character base64url strings and never GUID-shaped, so the ":guid" routes take ids and the others
/// take tokens.
/// </summary>
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

    [HttpGet("{inviteId:guid}", Name = "GetInvitationById")]
    [ProducesResponseType(typeof(OrganizationInvitationDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetInvitationById(Guid inviteId)
    {
        var result = await _mediator.Send(new GetInvitationByIdQuery(inviteId));
        return Ok(result);
    }

    [HttpGet("{token}")]
    [ProducesResponseType(typeof(InvitationPreviewDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetInvitationPreview(string token)
    {
        var result = await _mediator.Send(new GetInvitationPreviewQuery(token));
        return Ok(result);
    }

    [HttpPost("{inviteId:guid}/accept")]
    [ProducesResponseType(typeof(OrganizationMembershipDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> AcceptInvitationById(Guid inviteId)
    {
        var result = await _mediator.Send(new AcceptInvitationCommand(InvitationKey.ForId(inviteId)));
        return Ok(result);
    }

    [HttpPost("{token}/accept")]
    [ProducesResponseType(typeof(OrganizationMembershipDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> AcceptInvitation(string token)
    {
        var result = await _mediator.Send(new AcceptInvitationCommand(InvitationKey.ForToken(token)));
        return Ok(result);
    }

    [HttpPost("{inviteId:guid}/decline")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> DeclineInvitationById(Guid inviteId)
    {
        await _mediator.Send(new DeclineInvitationCommand(InvitationKey.ForId(inviteId)));
        return NoContent();
    }

    [HttpPost("{token}/decline")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> DeclineInvitation(string token)
    {
        await _mediator.Send(new DeclineInvitationCommand(InvitationKey.ForToken(token)));
        return NoContent();
    }
}
