using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Models.Organization;

namespace TimePlanner.API.Utilities;

public static class AuthorizationExtensions
{
    /// <summary>
    /// Checks if a user is an Admin or Owner of a specific organization.
    /// </summary>
    public static async Task<bool> IsAdminOrOwner(
        this ApplicationDbContext context,
        Guid userId,
        Guid organizationId,
        CancellationToken cancellationToken = default)
    {
        return await context.OrganizationMemberships
            .AnyAsync(m => m.OrganizationId == organizationId &&
                           m.UserId == userId &&
                           m.Status == MembershipStatus.Active &&
                           (m.Role == OrganizationRoles.Admin || m.Role == OrganizationRoles.Owner),
                      cancellationToken);
    }

    /// <summary>
    /// Checks if a user is an Owner of a specific organization.
    /// </summary>
    public static async Task<bool> IsOwner(
        this ApplicationDbContext context,
        Guid userId,
        Guid organizationId,
        CancellationToken cancellationToken = default)
    {
        return await context.OrganizationMemberships
            .AnyAsync(m => m.OrganizationId == organizationId &&
                           m.UserId == userId &&
                           m.Status == MembershipStatus.Active &&
                           m.Role == OrganizationRoles.Owner,
                      cancellationToken);
    }
}