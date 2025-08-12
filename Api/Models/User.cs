using Microsoft.AspNetCore.Identity;

namespace Api.Models;

public class User : IdentityUser<Guid>
{
    public string? RefreshToken { get; set; }
    public DateTime RefreshTokenExpiryTime { get; set; }

    public ICollection<Category> Categories { get; set; } = new List<Category>();
    public ICollection<TaskTemplate> TaskTemplates { get; set; } = new List<TaskTemplate>();
    public ICollection<TaskItem> Tasks { get; set; } = new List<TaskItem>();
}