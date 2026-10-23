namespace TimePlanner.API.DTOs.Organizations;

public class OrganizationDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public Guid OwnerId { get; set; }
    public string MemberJoinCode { get; set; } = string.Empty;
    public DateTime MemberJoinCodeExpiryUtc { get; set; }
    public string AdminJoinCode { get; set; } = string.Empty;
    public DateTime AdminJoinCodeExpiryUtc { get; set; }
}