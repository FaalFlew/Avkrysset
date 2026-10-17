using MediatR;
using Microsoft.AspNetCore.Identity;
using TimePlanner.API.Models;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Auth;

//================================================================================
// 1. The Command
//================================================================================
// The command is parameter-less because the user's ID is retrieved from the
// authenticated context (their JWT).
public record LogoutCommand : IRequest;

//================================================================================
// 2. The Handler
//================================================================================
public class LogoutCommandHandler : IRequestHandler<LogoutCommand>
{
    private readonly UserManager<User> _userManager;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<LogoutCommandHandler> _logger;

    public LogoutCommandHandler(
        UserManager<User> userManager,
        ICurrentUserService currentUserService,
        ILogger<LogoutCommandHandler> logger)
    {
        _userManager = userManager;
        _currentUserService = currentUserService;
        _logger = logger;
    }

    public async Task Handle(LogoutCommand request, CancellationToken cancellationToken)
    {
        // 1. Get the current user's ID from the JWT claims.
        var userId = _currentUserService.UserId;
        if (userId == null)
        {
            // This should theoretically not happen if the endpoint is protected by [Authorize],
            // but it's a good defensive check.
            _logger.LogWarning("Logout attempt by an unauthenticated user.");
            // We can just return silently. The goal (no valid refresh token) is achieved.
            return;
        }

        var user = await _userManager.FindByIdAsync(userId.Value.ToString());
        if (user == null)
        {
            _logger.LogWarning("Logout attempt for a non-existent user with ID {UserId}.", userId);
            return;
        }

        // 2. Invalidate the refresh token by setting it to null.
        user.RefreshToken = null;
        user.RefreshTokenExpiryTime = DateTime.UtcNow; // It's good practice to also expire the time.

        var result = await _userManager.UpdateAsync(user);

        if (result.Succeeded)
        {
            _logger.LogInformation("User {UserId} logged out successfully and refresh token was invalidated.", user.Id);
        }
        else
        {
            var errors = string.Join(", ", result.Errors.Select(e => e.Description));
            _logger.LogError("Error updating user during logout for User ID {UserId}: {Errors}", user.Id, errors);
            // Even if the update fails, we don't throw. The user's experience is still "logged out"
            // on the client-side. This becomes a server-side data consistency issue to monitor.
        }
    }
}