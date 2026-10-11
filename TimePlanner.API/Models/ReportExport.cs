namespace TimePlanner.API.Models;

/// <summary>
/// One generated analytics export (PDF or CSV). Append-only: rows are never updated or deleted by the app
/// (ApplicationDbContext rejects it); they disappear only with the requesting user or the organization.
/// </summary>
public class ReportExport
{
    public Guid Id { get; set; }

    /// <summary>"TP-yyyyMMdd-XXXXXXXX", printed on the document. Unique.</summary>
    public string DocumentId { get; set; } = string.Empty;

    /// <summary>"Personal", "Organization" or "Member".</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>"pdf" or "csv".</summary>
    public string Format { get; set; } = string.Empty;

    public Guid RequestedByUserId { get; set; }
    public User RequestedByUser { get; set; } = null!;

    /// <summary>The organization of an organization or member report.</summary>
    public Guid? OrganizationId { get; set; }
    public Organization.Organization? Organization { get; set; }

    /// <summary>Whose time the report shows (personal and member reports).</summary>
    public Guid? SubjectUserId { get; set; }

    /// <summary>Half-open range [RangeStartUtc, RangeEndUtc) of task starts.</summary>
    public DateTime RangeStartUtc { get; set; }
    public DateTime RangeEndUtc { get; set; }

    /// <summary>"monthly", "weekly" or "daily".</summary>
    public string ViewType { get; set; } = string.Empty;

    /// <summary>IANA zone the report was bucketed in.</summary>
    public string TimeZoneId { get; set; } = string.Empty;

    /// <summary>Culture used for dates and numbers ("invariant" when none or an unknown locale was sent).</summary>
    public string Culture { get; set; } = string.Empty;

    /// <summary>"A4" or "Letter" for PDFs; null for CSV.</summary>
    public string? Paper { get; set; }

    /// <summary>SHA-256 of the exact bytes sent to the client (enables a later "verify this document" check).</summary>
    public byte[] ContentSha256 { get; set; } = Array.Empty<byte>();

    public DateTime CreatedOnUtc { get; set; }
}
