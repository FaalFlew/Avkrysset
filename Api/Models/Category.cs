using System.ComponentModel.DataAnnotations;

namespace Api.Models;

public class Category
{
    public Guid Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [MaxLength(7)] // e.g., "#RRGGBB"
    public string Color { get; set; } = string.Empty;

    // Foreign Key to link this category to a user
    public Guid UserId { get; set; }

    // Navigation property back to the User
    public User User { get; set; } = null!;
}