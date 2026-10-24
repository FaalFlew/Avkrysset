using System.ComponentModel.DataAnnotations;
using TimePlanner.API.Models.Common; // Add this using

namespace TimePlanner.API.Models;

public class Category : AuditableEntity // Inherit from AuditableEntity
{
    // Id is now in the base class, so we remove it from here.
    // public Guid Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [MaxLength(7)]
    public string Color { get; set; } = string.Empty;

    // This is the owner of the category.
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

    // Remove the audit fields if you had them here separately.
}