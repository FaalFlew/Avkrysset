using MediatR;
using Microsoft.AspNetCore.Mvc;
using Api.DTOs.Auth;
using Api.Features.Commands.Auth;
namespace Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly ISender _mediator;
    private readonly IConfiguration _configuration;


    public AuthController(ISender mediator, IConfiguration configuration)
    {
        _mediator = mediator;
        _configuration = configuration;

    }

    [HttpPost("register")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Register(RegisterRequest request)
    {
        var command = new RegisterCommand(request.Email, request.Password, request.MigrationData);
        await _mediator.Send(command);

        return Ok(new { Message = "Registration successful. Please check your email to confirm your account." });
    }

    [HttpGet("confirm-email")]
    [ProducesResponseType(StatusCodes.Status302Found)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ConfirmEmail([FromQuery] string userId, [FromQuery] string token)
    {
        var command = new ConfirmEmailCommand(userId, token);
        await _mediator.Send(command);

        var frontendLoginUrl = _configuration["FrontendBaseUrl"] + "/login?confirmed=true";
        return Redirect(frontendLoginUrl);
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


    [HttpPost("forgot-password")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request)
    {
        var command = new ForgotPasswordCommand(request.Email);
        await _mediator.Send(command);

        return Ok(new { Message = "If an account with that email exists, a password reset link has been sent." });
    }

    [HttpPost("reset-password")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest request)
    {
        var command = new ResetPasswordCommand(request.UserId, request.Token, request.NewPassword);
        await _mediator.Send(command);
        return Ok(new { Message = "Your password has been reset successfully. You can now log in." });
    }
}