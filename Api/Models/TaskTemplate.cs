using System.ComponentModel.DataAnnotations;

namespace Api.Models;

public class TaskTemplate
{
    public Guid Id { get; set; }

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