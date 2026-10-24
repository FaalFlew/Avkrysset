namespace TimePlanner.API.Features.Commands.Auth;

/// <summary>Configuration section "Auth" (key "Auth:RefreshTokenGraceSeconds").</summary>
public sealed class RefreshTokenOptions
{
    public const string Section = "Auth";

    /// <summary>
    /// For this many seconds after a rotation, the refresh token that was replaced still gets the CURRENT pair (no further
    /// rotation), so a refresh response that never reached the client (timeout on a cold start, two tabs refreshing at
    /// once) doesn't end the session. 0 turns the grace period off.
    /// </summary>
    public int RefreshTokenGraceSeconds { get; set; } = 120;

    public TimeSpan GracePeriod => TimeSpan.FromSeconds(Math.Max(0, RefreshTokenGraceSeconds));
}
