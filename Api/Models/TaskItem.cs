using System.ComponentModel.DataAnnotations;
using Api.Models.Common;

namespace Api.Models;

public class TaskItem : AuditableEntity
{
    [Required]
    [MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    public DateTime Start { get; set; }

    public double Duration { get; set; }

    public Guid CategoryId { get; set; }
    public Guid UserId { get; set; }
    public Guid? TemplateId { get; set; }

    public Category Category { get; set; } = null!;
    public User User { get; set; } = null!;
}
