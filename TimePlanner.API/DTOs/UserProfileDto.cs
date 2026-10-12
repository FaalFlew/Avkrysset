namespace TimePlanner.API.DTOs;

public class UserProfileDto
{
    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string? DisplayName { get; set; } // null when the user hasn't set one
}

public class UpdateUserProfileRequest
{
    public string? DisplayName { get; set; }
}
