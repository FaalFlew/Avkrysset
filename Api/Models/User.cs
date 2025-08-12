using Microsoft.AspNetCore.Identity;

namespace Api.Models;

// We inherit from IdentityUser<Guid> to get all the standard identity fields
// (Id, UserName, Email, PasswordHash, etc.) for free. Using Guid as the
// primary key type is generally better than string for performance.
public class User : IdentityUser<Guid>
{
    // Properties for our JWT Refresh Token flow
    public string? RefreshToken { get; set; }
    public DateTime RefreshTokenExpiryTime { get; set; }

    // Navigation properties for EF Core to link this user to their data.
    // When a user is loaded, EF Core can also load their related data.
    public ICollection<Category> Categories { get; set; } = new List<Category>();
    public ICollection<TaskTemplate> TaskTemplates { get; set; } = new List<TaskTemplate>();
    public ICollection<TaskItem> Tasks { get; set; } = new List<TaskItem>();
}