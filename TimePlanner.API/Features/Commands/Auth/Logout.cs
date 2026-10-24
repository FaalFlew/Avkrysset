using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Auth;

//================================================================================
// 1. The Command
//================================================================================
// Ends a session server-side by revoking the stored refresh tokens (the current one and the previous one kept for the
// refresh grace period). It does not need a valid access token: the session is revoked when the caller is signed in
// (valid JWT) OR when it presents the current or the previous refresh token of a user (also an expired one). The
// caller is never told whether anything was revoked.
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
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<LogoutCommandHandler> _logger;

    public LogoutCommandHandler(
        ApplicationDbContext context,
        ICurrentUserService currentUserService,
        TimeProvider timeProvider,
        ILogger<LogoutCommandHandler> logger)
    {
        _context = context;
        _currentUserService = currentUserService;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    public async Task Handle(LogoutCommand request, CancellationToken cancellationToken)
    {
        // 1. A signed-in caller (valid access token): revoke their session, whatever refresh tokens are stored.
        var userId = _currentUserService.UserId;
        var revoked = userId is not null && await RevokeAsync(userId.Value, presentedToken: null, cancellationToken);
        if (revoked)
        {
            _logger.LogInformation("User {UserId} logged out; refresh tokens revoked (access token).", userId);
        }

        // 2. A presented refresh token, current or previous: revoke the session it belongs to, even when it has expired
        //    (the client may hold the previous token because it never received a rotation's response).
        var token = RefreshTokenComparison.Normalize(request.RefreshToken);
        if (token is null)
        {
            return;
        }

        var candidates = await _context.Users
            .AsNoTracking()
            .Where(u => u.RefreshToken == token || u.PreviousRefreshToken == token)
            .Select(u => new { u.Id, u.RefreshToken, u.PreviousRefreshToken })
            .Take(MaxCandidates)
            .ToListAsync(cancellationToken);

        foreach (var candidate in candidates)
        {
            var matches = RefreshTokenComparison.FixedTimeEquals(token, candidate.RefreshToken)
                          | RefreshTokenComparison.FixedTimeEquals(token, candidate.PreviousRefreshToken);
            if (matches && await RevokeAsync(candidate.Id, token, cancellationToken))
            {
                revoked = true;
                _logger.LogInformation("User {UserId} logged out; refresh tokens revoked (refresh token).", candidate.Id);
            }
        }

        if (!revoked)
        {
            // Never log the token itself.
            _logger.LogInformation("Logout with a refresh token that matches no stored session; nothing revoked.");
        }
    }

    /// <summary>
    /// Clears the current and the previous refresh token in a single UPDATE. With <paramref name="presentedToken"/> only
    /// while that token is still the current or the previous one (a token two rotations old ends nothing). The
    /// ConcurrencyStamp changes too, so a save elsewhere that loaded the user earlier can't write the old session back,
    /// and a racing refresh's conditional rotation finds no current token.
    /// </summary>
    private async Task<bool> RevokeAsync(Guid userId, string? presentedToken, CancellationToken cancellationToken)
    {
        var users = _context.Users.Where(u => u.Id == userId);
        if (presentedToken is not null)
        {
            users = users.Where(u => u.RefreshToken == presentedToken || u.PreviousRefreshToken == presentedToken);
        }

        var now = _timeProvider.GetUtcNow().UtcDateTime;
        var concurrencyStamp = Guid.NewGuid().ToString();
        var rows = await users.ExecuteUpdateAsync(setters => setters
            .SetProperty(u => u.RefreshToken, (string?)null)
            .SetProperty(u => u.RefreshTokenExpiryTime, now)
            .SetProperty(u => u.PreviousRefreshToken, (string?)null)
            .SetProperty(u => u.PreviousRefreshTokenValidUntilUtc, (DateTime?)null)
            .SetProperty(u => u.ConcurrencyStamp, concurrencyStamp), cancellationToken);

        return rows > 0;
    }
}
