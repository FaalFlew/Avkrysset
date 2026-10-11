namespace TimePlanner.API.DTOs.Organizations;

public class JoinCodesDto
{
    public Guid OrganizationId { get; set; }
    public string MemberJoinCode { get; set; } = string.Empty;
    public DateTime MemberJoinCodeExpiryUtc { get; set; }
    public string AdminJoinCode { get; set; } = string.Empty;
    public DateTime AdminJoinCodeExpiryUtc { get; set; }
}