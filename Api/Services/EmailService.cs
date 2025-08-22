using Microsoft.Extensions.Options;
using SendGrid;
using SendGrid.Helpers.Mail;
using System.Threading.Tasks;

namespace Api.Services;

public class SendGridSettings
{
    public string ApiKey { get; set; } = string.Empty;
    public string FromEmail { get; set; } = string.Empty;
    public string FromName { get; set; } = string.Empty;
}

public class EmailService : IEmailService
{
    private readonly ILogger<EmailService> _logger;
    private readonly SendGridSettings _settings;

    public EmailService(IOptions<SendGridSettings> settings, ILogger<EmailService> logger)
    {
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task SendEmailAsync(string toEmail, string subject, string htmlContent)
    {
        if (string.IsNullOrEmpty(_settings.ApiKey))
        {
            _logger.LogError("SendGrid API Key is not configured.");
            return;
        }

        var client = new SendGridClient(_settings.ApiKey);
        var from = new EmailAddress(_settings.FromEmail, _settings.FromName);
        var to = new EmailAddress(toEmail);
        var msg = MailHelper.CreateSingleEmail(from, to, subject, "", htmlContent);

        var response = await client.SendEmailAsync(msg);

        if (response.IsSuccessStatusCode)
        {
            _logger.LogInformation("Email to {ToEmail} sent successfully.", toEmail);
        }
        else
        {
            _logger.LogError("Failed to send email to {ToEmail}. Status Code: {StatusCode}, Body: {Body}",
                toEmail, response.StatusCode, await response.Body.ReadAsStringAsync());
        }
    }
}