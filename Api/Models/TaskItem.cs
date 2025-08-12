using System.ComponentModel.DataAnnotations;

namespace Api.Models;

public class TaskItem
{
    public Guid Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    // We use DateTime here because it's the native, efficient way to store
    // and query dates in a database, unlike strings.
    public DateTime Start { get; set; }

    // Duration in hours
    public double Duration { get; set; }

    // Foreign Keys
    public Guid CategoryId { get; set; }
    public Guid UserId { get; set; }
    public Guid? TemplateId { get; set; } // Nullable, as a task might not be from a template

    // Navigation Properties
    public Category Category { get; set; } = null!;
    public User User { get; set; } = null!;
}