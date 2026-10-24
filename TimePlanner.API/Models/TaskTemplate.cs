using System.ComponentModel.DataAnnotations;
using TimePlanner.API.Models.Common; // Add this using

namespace TimePlanner.API.Models;

public class TaskTemplate : AuditableEntity // Inherit from AuditableEntity
{
    [Required]
    [MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    // Duration in hours
    public double Duration { get; set; }

    // Foreign Keys
    public Guid CategoryId { get; set; }
    public Guid UserId { get; set; }

    // Navigation Properties
    public Category Category { get; set; } = null!;
    public User User { get; set; } = null!;
}
