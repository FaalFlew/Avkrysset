using System.ComponentModel.DataAnnotations;
using Api.Models.Common;

namespace Api.Models;

public class Category : AuditableEntity
{

    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [MaxLength(7)]
    public string Color { get; set; } = string.Empty;

    public Guid UserId { get; set; }
    public User User { get; set; } = null!;

}