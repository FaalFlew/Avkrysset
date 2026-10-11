using MediatR;
using Microsoft.AspNetCore.Mvc;
using TimePlanner.API.DTOs.Auth;
using TimePlanner.API.Features.Commands.Auth;
using Microsoft.AspNetCore.Authorization;

namespace TimePlanner.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly ISender _mediator; // Use ISender for sending requests
    private readonly IConfiguration _configuration; // 2. ADD THIS FIELD

    public AuthController(ISender mediator, IConfiguration configuration)
    {
        _mediator = mediator;
        _configuration = configuration; // 4. ASSIGN IT

    }


    [HttpPost("register")]
    [ProducesResponseType(StatusCodes.Status200OK)] // Success is now just an OK message
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Register(RegisterRequest request)
    {
        var command = new RegisterCommand(request.Email, request.Password, request.MigrationData);
        await _mediator.Send(command);

        // Return a message instead of tokens
        return Ok(new { Message = "Registration successful. Please check your email to confirm your account." });
    }

    // ADD NEW ENDPOINT
    [HttpGet("confirm-email")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ConfirmEmail([FromQuery] string userId, [FromQuery] string token)
    {
            var command = new ConfirmEmailCommand(userId, token);
            await _mediator.Send(command);

            return Ok(new { Message = "Email confirmed successfully." });
    }

    [HttpPost("resend-confirmation-email")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ResendConfirmationEmail(ResendConfirmationRequest request)
    {
        var command = new ResendConfirmationEmailCommand(request.Email);
        await _mediator.Send(command);
        // Always return a success-like message to prevent email enumeration.
        return Ok(new { Message = "If an account with that email exists and is unconfirmed, a new confirmation link has been sent." });
    }

    [HttpPost("forgot-password")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest request)
    {
        var command = new ForgotPasswordCommand(request.Email);
        await _mediator.Send(command);

        // Always return a success-like message to prevent email enumeration.
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

    [HttpPost("login")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        var command = new LoginCommand(request.Email, request.Password);
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

    [HttpPost("logout")]
    [Authorize] // IMPORTANT: This endpoint requires a valid access token.
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Logout()
    {
        var command = new LogoutCommand();
        await _mediator.Send(command);

        // A successful logout typically returns 204 No Content,
        // as there's no data to return to the client.
        return NoContent();
    }
}