namespace TimePlanner.API.DTOs.Auth;

// This will be the standard response for both login and registration.
public class AuthResponse
{
    public string AccessToken { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
}