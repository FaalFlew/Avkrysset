namespace TimePlanner.API.DTOs.Auth;

/// <summary>Optional body of POST /api/auth/logout.</summary>
public class LogoutRequest
{
    /// <summary>The refresh token the client is discarding; its session is revoked when it is the stored one.</summary>
    public string? RefreshToken { get; set; }
}
