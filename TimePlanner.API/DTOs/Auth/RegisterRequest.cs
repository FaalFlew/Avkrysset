namespace TimePlanner.API.DTOs.Auth;

// This DTO includes the optional payload for migrating a guest's local data.
public class RegisterRequest
{
    public string Email { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public MigrationData? MigrationData { get; set; }
}