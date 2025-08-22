using MediatR;
using Microsoft.AspNetCore.Identity;
using Api.Models;
using Api.Services;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace Api.Features.Commands.Auth;

public record ResendConfirmationEmailCommand(string Email) : IRequest;


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


        if (user != null && !user.EmailConfirmed)
        {

            var token = await _userManager.GenerateEmailConfirmationTokenAsync(user);
            var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));

            var frontendUrl = _configuration["FrontendBaseUrl"];
            var confirmationLink = $"{frontendUrl}/confirm-email?userId={user.Id}&token={encodedToken}";

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
            _logger.LogWarning("Resend confirmation requested for a non-existent or already confirmed email: {Email}", request.Email);
        }

        return;
    }
}