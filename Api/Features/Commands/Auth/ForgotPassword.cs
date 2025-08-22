using MediatR;
using Microsoft.AspNetCore.Identity;
using Api.Models;
using Api.Services;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace Api.Features.Commands.Auth;

public record ForgotPasswordCommand(string Email) : IRequest;

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


        if (user != null && user.EmailConfirmed)
        {
            var token = await _userManager.GeneratePasswordResetTokenAsync(user);
            var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));

            var frontendUrl = _configuration["FrontendBaseUrl"];
            var resetLink = $"{frontendUrl}/reset-password?userId={user.Id}&token={encodedToken}";

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
            _logger.LogWarning("Password reset requested for a non-existent or unconfirmed email: {Email}", request.Email);
        }

        return;
    }
}