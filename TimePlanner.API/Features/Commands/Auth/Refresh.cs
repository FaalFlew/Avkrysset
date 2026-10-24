using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Auth;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Auth;

//================================================================================
// 1. The Command
//================================================================================
public record RefreshCommand(string RefreshToken) : IRequest<AuthResponse>;

//================================================================================
// 2. The Handler
//================================================================================
/// <summary>
/// Exchanges a refresh token for a new pair.
/// - The CURRENT token is rotated: a new token is stored and the presented one becomes the previous token, valid for the
///   grace period (Auth:RefreshTokenGraceSeconds, default 120 s).
/// - The PREVIOUS token, within its grace period, gets the CURRENT pair: a fresh access token and the stored current
///   refresh token, without rotating again. So a response lost to a client timeout, or two tabs refreshing at once,
///   still end with one working token.
/// - Anything else (unknown, revoked, expired, previous after its grace period) is 401.
/// Rotation is a conditional UPDATE: of two concurrent refreshes with the same token only one rotates; the other
/// reloads, finds its token is now the previous one and gets the same current pair. A refresh that loses to a logout
/// finds nothing and is 401.
/// </summary>
public class RefreshCommandHandler : IRequestHandler<RefreshCommand, AuthResponse>
{
    private static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(7);

    // A lookup by token is case-insensitive in SQL Server; each row is confirmed with an exact comparison.
    private const int MaxCandidates = 4;

    // Each lost rotation means another request changed the row; after a reload the outcome is decided without writing.
    private const int MaxAttempts = 3;

    private readonly ApplicationDbContext _context;
    private readonly ITokenService _tokenService;
    private readonly TimeProvider _timeProvider;
    private readonly TimeSpan _gracePeriod;
    private readonly ILogger<RefreshCommandHandler> _logger;

    public RefreshCommandHandler(
        ApplicationDbContext context,
        ITokenService tokenService,
        TimeProvider timeProvider,
        IOptions<RefreshTokenOptions> options,
        ILogger<RefreshCommandHandler> logger)
    {
        _context = context;
        _tokenService = tokenService;
        _timeProvider = timeProvider;
        _gracePeriod = options.Value.GracePeriod;
        _logger = logger;
    }

    public async Task<AuthResponse> Handle(RefreshCommand request, CancellationToken cancellationToken)
    {
        var token = RefreshTokenComparison.Normalize(request.RefreshToken) ?? throw InvalidToken();

        for (var attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            var now = _timeProvider.GetUtcNow().UtcDateTime;
            var candidates = await _context.Users
                .AsNoTracking()
                .Where(u => u.RefreshToken == token || u.PreviousRefreshToken == token)
                .Take(MaxCandidates)
                .ToListAsync(cancellationToken);

            // --- 1. The current token: rotate it ---
            var user = candidates.FirstOrDefault(u => RefreshTokenComparison.FixedTimeEquals(token, u.RefreshToken));
            if (user is not null)
            {
                if (user.RefreshTokenExpiryTime <= now)
                {
                    throw new UnauthorizedAccessException("Refresh token has expired. Please log in again.");
                }

                var newRefreshToken = _tokenService.GenerateRefreshToken();
                if (await RotateAsync(user.Id, token, newRefreshToken, now, cancellationToken))
                {
                    return new AuthResponse
                    {
                        AccessToken = await _tokenService.GenerateAccessTokenAsync(user),
                        RefreshToken = newRefreshToken
                    };
                }

                // Another request changed the row first (a concurrent refresh, a logout or a login): look again.
                _logger.LogInformation("Refresh for user {UserId} lost a race (attempt {Attempt}); reloading.", user.Id, attempt);
                continue;
            }

            // --- 2. The previous token within its grace period: the current pair, no rotation ---
            var rotated = candidates.FirstOrDefault(u => RefreshTokenComparison.FixedTimeEquals(token, u.PreviousRefreshToken));
            if (rotated is { RefreshToken: not null } && rotated.PreviousRefreshTokenValidUntilUtc > now
                                                       && rotated.RefreshTokenExpiryTime > now)
            {
                _logger.LogInformation(
                    "Refresh for user {UserId} with the previous refresh token within the grace period; re-issuing the current pair.",
                    rotated.Id);
                return new AuthResponse
                {
                    AccessToken = await _tokenService.GenerateAccessTokenAsync(rotated),
                    RefreshToken = rotated.RefreshToken
                };
            }

            throw InvalidToken();
        }

        throw InvalidToken();
    }

    /// <summary>
    /// Stores the new token in one UPDATE, only while <paramref name="presented"/> is still the current token. The
    /// ConcurrencyStamp changes too, so a save elsewhere that loaded the user earlier can't write the old token back.
    /// </summary>
    private async Task<bool> RotateAsync(Guid userId, string presented, string newRefreshToken, DateTime now,
        CancellationToken cancellationToken)
    {
        var expiry = now + RefreshTokenLifetime;
        DateTime? previousValidUntil = now + _gracePeriod;
        var concurrencyStamp = Guid.NewGuid().ToString();

        var rows = await _context.Users
            .Where(u => u.Id == userId && u.RefreshToken == presented)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(u => u.RefreshToken, newRefreshToken)
                .SetProperty(u => u.RefreshTokenExpiryTime, expiry)
                .SetProperty(u => u.PreviousRefreshToken, presented)
                .SetProperty(u => u.PreviousRefreshTokenValidUntilUtc, previousValidUntil)
                .SetProperty(u => u.ConcurrencyStamp, concurrencyStamp), cancellationToken);

        return rows == 1;
    }

    private static UnauthorizedAccessException InvalidToken() => new("Invalid refresh token.");
}
