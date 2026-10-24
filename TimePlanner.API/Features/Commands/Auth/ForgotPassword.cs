using MediatR;
using Microsoft.AspNetCore.Identity;
using TimePlanner.API.Models;
using TimePlanner.API.Services;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace TimePlanner.API.Features.Commands.Auth;

//================================================================================
// 1. The Command
//================================================================================
public record ForgotPasswordCommand(string Email) : IRequest;

//================================================================================
// 2. The Handler
//================================================================================
public class ForgotPasswordCommandHandler : IRequestHandler<ForgotPasswordCommand>
{
    private readonly UserManager<User> _userManager;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ForgotPasswordCommandHandler> _logger;

    public ForgotPasswordCommandHandler(
        UserManager<User> userManager,
        IEmailService emailService,
        IConfiguration configuration,
        ILogger<ForgotPasswordCommandHandler> logger)
    {
        _userManager = userManager;
        _emailService = emailService;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task Handle(ForgotPasswordCommand request, CancellationToken cancellationToken)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);

        // IMPORTANT: For security, we do not reveal whether the user was found or not.
        // We proceed as if the email was sent, even if the user doesn't exist.
        if (user != null && user.EmailConfirmed)
        {
            // 1. Generate the password reset token
            var token = await _userManager.GeneratePasswordResetTokenAsync(user);
            // 2. URL-encode the token
            var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));

            // 3. Build the reset link
            // In appsettings.json, you should have: "FrontendBaseUrl": "http://localhost:5173"
            var frontendUrl = _configuration["FrontendBaseUrl"];
            var resetLink = $"{frontendUrl}/reset-password?userId={user.Id}&token={encodedToken}";

            // 4. Create email body and send
            var emailBody = $"<h1>Reset Your Password</h1>" +
                            $"<p>You have requested to reset your password. Please click the link below to proceed:</p>" +
                            $"<p><a href='{resetLink}'>Reset Password</a></p>" +
                            $"<p>If you did not request a password reset, you can safely ignore this email.</p>" +
                            $"<p>Thank you,</p><p>The Time Planner Team</p>";

            await _emailService.SendEmailAsync(user.Email!, "Reset Your Password", emailBody);

            _logger.LogInformation("Password reset email sent to {Email}", request.Email);
        }
        else
        {
            // Log for internal diagnostics but do not inform the client.
            _logger.LogWarning("Password reset requested for a non-existent or unconfirmed email: {Email}", request.Email);
        }

        // The handler completes successfully regardless.
        return;
    }
}