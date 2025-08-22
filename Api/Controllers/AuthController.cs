using MediatR;
using Microsoft.AspNetCore.Mvc;
using Api.DTOs.Auth;
using Api.Features.Auth.Commands;
using Api.Features.Commands.Auth;
namespace Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly ISender _mediator;

    public AuthController(ISender mediator)
    {
        _mediator = mediator;
    }

    [HttpPost("register")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Register(RegisterRequest request)
    {
        var command = new RegisterCommand(
            request.Email,
            request.Password,
            request.MigrationData
        );

        var result = await _mediator.Send(command);

        return Ok(result);
    }

    [HttpPost("refresh")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Refresh(RefreshTokenRequest request)
    {
        var command = new RefreshCommand(request.RefreshToken);
        var result = await _mediator.Send(command);
        return Ok(result);
    }
}