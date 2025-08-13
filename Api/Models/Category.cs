using System.ComponentModel.DataAnnotations;

namespace Api.Models;

public class Category
{
    public Guid Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [MaxLength(7)]
    public string Color { get; set; } = string.Empty;

    public Guid UserId { get; set; }

    public User User { get; set; } = null!;
}