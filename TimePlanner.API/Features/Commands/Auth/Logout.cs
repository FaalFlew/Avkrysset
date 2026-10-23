using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Auth;

//================================================================================
// 1. The Command
//================================================================================
// Ends a session server-side by revoking the stored refresh token. It does not need a valid access token: the
// session is revoked when the caller is signed in (valid JWT) OR when it presents the refresh token that is stored
// for a user (also an expired one). The caller is never told whether anything was revoked.
public record LogoutCommand(string? RefreshToken = null) : IRequest;

//================================================================================
// 2. The Handler
//================================================================================
public class LogoutCommandHandler : IRequestHandler<LogoutCommand>
{
    // A lookup by token is case-insensitive in SQL Server, so in theory more than one row can come back; each one
    // is confirmed with an exact comparison. Real tokens are random, so this is 0 or 1 row in practice.
    private const int MaxCandidates = 4;

    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;
    private readonly ILogger<LogoutCommandHandler> _logger;

    public LogoutCommandHandler(
        ApplicationDbContext context,
        ICurrentUserService currentUserService,
        ILogger<LogoutCommandHandler> logger)
    {
        _context = context;
        _currentUserService = currentUserService;
        _logger = logger;
    }

    public async Task Handle(LogoutCommand request, CancellationToken cancellationToken)
    {
        // 1. A signed-in caller (valid access token): revoke their session, whatever refresh token is stored.
        var userId = _currentUserService.UserId;
        var revoked = userId is not null && await RevokeAsync(userId.Value, expectedToken: null, cancellationToken);
        if (revoked)
        {
            _logger.LogInformation("User {UserId} logged out; refresh token revoked (access token).", userId);
        }

        // 2. A presented refresh token: revoke the session it belongs to, even when it has expired.
        var token = RefreshTokenComparison.Normalize(request.RefreshToken);
        if (token is null)
        {
            return;
        }

        var candidates = await _context.Users
            .AsNoTracking()
            .Where(u => u.RefreshToken == token)
            .Select(u => new { u.Id, u.RefreshToken })
            .Take(MaxCandidates)
            .ToListAsync(cancellationToken);

        foreach (var candidate in candidates)
        {
            if (RefreshTokenComparison.FixedTimeEquals(token, candidate.RefreshToken)
                && await RevokeAsync(candidate.Id, candidate.RefreshToken, cancellationToken))
            {
                revoked = true;
                _logger.LogInformation("User {UserId} logged out; refresh token revoked (refresh token).", candidate.Id);
            }
        }

        if (!revoked)
        {
            // Never log the token itself.
            _logger.LogInformation("Logout with a refresh token that matches no stored session; nothing revoked.");
        }
    }

    /// <summary>
    /// Clears the refresh token in a single UPDATE. With <paramref name="expectedToken"/> only while that token is still
    /// the stored one, so a refresh that rotated it first keeps its new token (the client revokes that one when it
    /// sees it). The ConcurrencyStamp changes too: a refresh or login that loaded the user before this UPDATE then
    /// fails its optimistic-concurrency save instead of writing the old session back.
    /// </summary>
    private async Task<bool> RevokeAsync(Guid userId, string? expectedToken, CancellationToken cancellationToken)
    {
        var users = _context.Users.Where(u => u.Id == userId);
        if (expectedToken is not null)
        {
            users = users.Where(u => u.RefreshToken == expectedToken);
        }

        var now = DateTime.UtcNow;
        var concurrencyStamp = Guid.NewGuid().ToString();
        var rows = await users.ExecuteUpdateAsync(setters => setters
            .SetProperty(u => u.RefreshToken, (string?)null)
            .SetProperty(u => u.RefreshTokenExpiryTime, now)
            .SetProperty(u => u.ConcurrencyStamp, concurrencyStamp), cancellationToken);

        return rows > 0;
    }
}
