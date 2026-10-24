namespace TimePlanner.API.Services;

/// <summary>
/// Defines a contract for a service that sends emails.
/// </summary>
public interface IEmailService
{
    /// <summary>
    /// Sends an email.
    /// </summary>
    /// <param name="toEmail">The recipient's email address.</param>
    /// <param name="subject">The subject of the email.</param>
    /// <param name="htmlContent">The HTML body of the email.</param>
    /// <returns>A task representing the asynchronous operation.</returns>
    Task<bool> SendEmailAsync(string toEmail, string subject, string htmlContent);
}