namespace TimePlanner.API.DTOs.Organizations;

public class OrganizationDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid OwnerId { get; set; }
    public string TimeZoneId { get; set; } = "UTC"; // IANA id; org analytics/reports use this calendar

    // OrganizationPalette.ColorFor(Id): the colour personal analytics already use for this organization.
    public string Color { get; set; } = string.Empty;

    // The caller's role: "Owner" | "Admin" | "Member". Null only in real-time (SignalR) payloads, which go to every member.
    public string? MyRole { get; set; }

    // Join codes and their expiries are only shown to Owners and Admins (decision Q8); null for members and in
    // real-time payloads.
    public string? MemberJoinCode { get; set; }
    public DateTime? MemberJoinCodeExpiryUtc { get; set; }
    public string? AdminJoinCode { get; set; }
    public DateTime? AdminJoinCodeExpiryUtc { get; set; }
}
