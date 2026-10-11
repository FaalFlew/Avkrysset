namespace TimePlanner.API.Models.Common;

/// <summary>
/// A base class for entities that require auditing and soft-delete functionality.
/// </summary>
public abstract class AuditableEntity
{
    public Guid Id { get; set; }

    // Audit Fields for Creation
    public DateTime CreatedOnUtc { get; set; }
    public Guid CreatedByUserId { get; set; }

    // Audit Fields for Modification
    public DateTime? UpdatedOnUtc { get; set; }
    public Guid? UpdatedByUserId { get; set; }

    // Soft Delete Fields
    public bool IsDeleted { get; set; }
    public DateTime? DeletedOnUtc { get; set; }
    public Guid? DeletedByUserId { get; set; }
}