using FluentValidation;
using MediatR;
using Microsoft.AspNetCore.Identity;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using TimePlanner.API.Models;
using TimePlanner.API.Exceptions;

namespace TimePlanner.API.Features.Commands.Auth;

//================================================================================
// 1. The Command & Validator (No Changes Here)
//================================================================================
public record ResetPasswordCommand(string UserId, string Token, string NewPassword) : IRequest;

public class ResetPasswordCommandValidator : AbstractValidator<ResetPasswordCommand>
{
    // ... validator code remains exactly the same ...
    public ResetPasswordCommandValidator()
    {
        RuleFor(x => x.UserId).NotEmpty();
        RuleFor(x => x.Token).NotEmpty();

        // Re-use the same strong password rules from registration.
        RuleFor(x => x.NewPassword)
            .NotEmpty().WithMessage("Password is required.")
            .MinimumLength(8).WithMessage("Password must be at least 8 characters long.")
            .Matches("[A-Z]").WithMessage("Password must contain at least one uppercase letter.")
            .Matches("[a-z]").WithMessage("Password must contain at least one lowercase letter.")
            .Matches("[0-9]").WithMessage("Password must contain at least one number.")
            .Matches("[^a-zA-Z0-9]").WithMessage("Password must contain at least one non-alphanumeric character.");
    }
}


//================================================================================
// 3. The Handler (WITH CHANGES)
//================================================================================
public class ResetPasswordCommandHandler : IRequestHandler<ResetPasswordCommand>
{
    private readonly UserManager<User> _userManager;
    private readonly ILogger<ResetPasswordCommandHandler> _logger;

    public ResetPasswordCommandHandler(UserManager<User> userManager, ILogger<ResetPasswordCommandHandler> logger)
    {
        _userManager = userManager;
        _logger = logger;
    }

    public async Task Handle(ResetPasswordCommand request, CancellationToken cancellationToken)
    {
        var user = await _userManager.FindByIdAsync(request.UserId);
        if (user == null)
        {
            // Don't reveal that the user doesn't exist.
            throw new BadRequestException("Invalid password reset request.");
        }

        var decodedToken = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(request.Token));

        // --- 1. Reset the password ---
        var resetResult = await _userManager.ResetPasswordAsync(user, decodedToken, request.NewPassword);

        if (!resetResult.Succeeded)
        {
            var errors = string.Join(", ", resetResult.Errors.Select(e => e.Description));
            _logger.LogWarning("Password reset failed for user {UserId}: {Errors}", user.Id, errors);
            throw new BadRequestException($"Password reset failed: {errors}");
        }

        _logger.LogInformation("Password successfully reset for user {UserId}", user.Id);

        // --- 2. Invalidate the refresh token (THE NEW LOGIC) ---
        // This is a critical security step. If a user resets their password,
        // it's often because they suspect a breach. Invalidating the refresh token
        // ensures that any compromised devices/sessions are logged out.
        user.RefreshToken = null;
        user.RefreshTokenExpiryTime = DateTime.UtcNow; // Expire the time as well for good measure.

        var updateResult = await _userManager.UpdateAsync(user);

        if (!updateResult.Succeeded)
        {
            // This is an edge case. The password was reset, but clearing the token failed.
            // We should log this as a high-priority error for investigation, but we don't
            // need to fail the entire operation for the user.
            var errors = string.Join(", ", updateResult.Errors.Select(e => e.Description));
            _logger.LogError("CRITICAL: User {UserId}'s password was reset, but their refresh token could not be invalidated. Manual intervention may be required. Errors: {Errors}", user.Id, errors);
        }
        else
        {
            _logger.LogInformation("Refresh token for user {UserId} was successfully invalidated after password reset.", user.Id);
        }
    }
}