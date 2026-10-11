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
public record ResendConfirmationEmailCommand(string Email) : IRequest;

//================================================================================
// 2. The Handler
//================================================================================
public class ResendConfirmationEmailCommandHandler : IRequestHandler<ResendConfirmationEmailCommand>
{
    private readonly UserManager<User> _userManager;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ResendConfirmationEmailCommandHandler> _logger;

    public ResendConfirmationEmailCommandHandler(
        UserManager<User> userManager,
        IEmailService emailService,
        IConfiguration configuration,
        ILogger<ResendConfirmationEmailCommandHandler> logger)
    {
        _userManager = userManager;
        _emailService = emailService;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task Handle(ResendConfirmationEmailCommand request, CancellationToken cancellationToken)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);

        // Security: Do not reveal if the user exists or is already confirmed.
        // We only proceed if the user exists AND their email is not yet confirmed.
        if (user != null && !user.EmailConfirmed)
        {
            // The logic here is identical to what we wrote in RegisterCommandHandler
            
            // 1. Generate a new confirmation token (this invalidates any old ones)
            var token = await _userManager.GenerateEmailConfirmationTokenAsync(user);
            // 2. URL-encode the token
            var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));

            // 3. Build the confirmation link
            var frontendUrl = _configuration["FrontendBaseUrl"];
            var confirmationLink = $"{frontendUrl}/confirm-email?userId={user.Id}&token={encodedToken}";

            // 4. Create email body and send
            var emailBody = $"<h1>Confirm Your Email Address</h1>" +
                            $"<p>You have requested to resend the email confirmation. Please click the link below:</p>" +
                            $"<p><a href='{confirmationLink}'>Confirm my email</a></p>" +
                            $"<p>If you did not make this request, you can safely ignore this email.</p>" +
                            $"<p>Thank you,</p><p>The Time Planner Team</p>";

            await _emailService.SendEmailAsync(user.Email!, "Confirm Your Email Address", emailBody);

            _logger.LogInformation("New confirmation email sent to {Email}", request.Email);
        }
        else
        {
            // Log for internal diagnostics but do not inform the client.
            _logger.LogWarning("Resend confirmation requested for a non-existent or already confirmed email: {Email}", request.Email);
        }

        // Handler completes successfully regardless to prevent email enumeration.
        return;
    }
}