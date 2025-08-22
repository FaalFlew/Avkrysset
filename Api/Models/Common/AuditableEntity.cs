namespace Api.Models.Common;

public abstract class AuditableEntity
{
    public Guid Id { get; set; }

    public DateTime CreatedOnUtc { get; set; }
    public Guid CreatedByUserId { get; set; }

    public DateTime? UpdatedOnUtc { get; set; }
    public Guid? UpdatedByUserId { get; set; }

    public bool IsDeleted { get; set; }
    public DateTime? DeletedOnUtc { get; set; }
    public Guid? DeletedByUserId { get; set; }
}