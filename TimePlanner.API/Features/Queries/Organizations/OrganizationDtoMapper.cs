using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>The one mapping from <see cref="Organization"/> to <see cref="OrganizationDto"/>.</summary>
public static class OrganizationDtoMapper
{
    /// <summary>
    /// The organization as seen by a viewer with <paramref name="myRole"/> (null = a real-time payload sent to every
    /// member). Join codes and their expiries are set only for Owners and Admins.
    /// </summary>
    public static OrganizationDto For(Organization organization, string? myRole)
    {
        var seesCodes = AuthorizationExtensions.IsAdminOrOwnerRole(myRole);
        return new OrganizationDto
        {
            Id = organization.Id,
            Name = organization.Name,
            OwnerId = organization.OwnerId,
            TimeZoneId = organization.TimeZoneId,
            Color = OrganizationPalette.ColorFor(organization.Id),
            MyRole = myRole,
            MemberJoinCode = seesCodes ? organization.MemberJoinCode : null,
            MemberJoinCodeExpiryUtc = seesCodes ? organization.MemberJoinCodeExpiryUtc : null,
            AdminJoinCode = seesCodes ? organization.AdminJoinCode : null,
            AdminJoinCodeExpiryUtc = seesCodes ? organization.AdminJoinCodeExpiryUtc : null
        };
    }
}
