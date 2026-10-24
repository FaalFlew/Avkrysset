using Microsoft.Extensions.Options;
using PostmarkDotNet;
using TimePlanner.API.Services;

namespace TimePlanner.API.Services;

// A simple DTO to hold our settings
public class PostmarkSettings
{
    public string ServerToken { get; set; } = string.Empty;
    public string FromEmail { get; set; } = string.Empty;
    public string FromName { get; set; } = string.Empty;
}


public class EmailService : IEmailService
{
    private readonly ILogger<EmailService> _logger;
    private readonly PostmarkSettings _settings;

    public EmailService(IOptions<PostmarkSettings> settings, ILogger<EmailService> logger)
    {
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task<bool> SendEmailAsync(string toEmail, string subject, string htmlContent)
    {
        if (string.IsNullOrEmpty(_settings.ServerToken))
        {
            _logger.LogError("Postmark Server Token is not configured.");
            return false;
        }

        try
        {
            // The Postmark client is lightweight and can be created per request.
            var client = new PostmarkClient(_settings.ServerToken);

            var message = new PostmarkMessage
            {
                To = toEmail,
                From = $"{_settings.FromName} <{_settings.FromEmail}>",
                TrackOpens = true,
                Subject = subject,
                HtmlBody = htmlContent,
                MessageStream = "outbound" // Use "outbound" for transactional emails
            };

            var response = await client.SendMessageAsync(message);

            if (response.Status == PostmarkStatus.Success)
            {
                _logger.LogInformation("Email to {ToEmail} sent successfully via Postmark. MessageID: {MessageID}",
                    toEmail, response.MessageID);
                return true;
            }
            else
            {
                _logger.LogError("Failed to send email via Postmark to {ToEmail}. Status: {Status}, Message: {Message}",
                    toEmail, response.Status, response.Message);
                return false;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An unexpected error occurred while sending an email with Postmark to {ToEmail}.", toEmail);
            return false;
        }
    }
}