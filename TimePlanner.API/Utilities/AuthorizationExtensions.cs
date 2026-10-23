using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models.Organization;

namespace TimePlanner.API.Utilities;

public static class AuthorizationExtensions
{
    /// <summary>
    /// Returned (as 404) to anyone who is not an active member, so the response doesn't reveal
    /// whether the organization exists.
    /// </summary>
    public const string OrganizationNotFoundMessage = "Organization not found.";

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

    public static bool IsAdminOrOwnerRole(string? role) =>
        role is OrganizationRoles.Admin or OrganizationRoles.Owner;

    /// <summary>
    /// The caller's active membership. Anyone else (never joined, left, removed, or the organization
    /// doesn't exist) gets 404 "Organization not found."
    /// </summary>
    public static async Task<OrganizationMembership> RequireActiveMember(
        this ApplicationDbContext context,
        Guid userId,
        Guid organizationId,
        CancellationToken cancellationToken = default)
    {
        var membership = await context.OrganizationMemberships
            .AsNoTracking()
            .FirstOrDefaultAsync(m => m.OrganizationId == organizationId &&
                                      m.UserId == userId &&
                                      m.Status == MembershipStatus.Active,
                                 cancellationToken);

        return membership ?? throw new KeyNotFoundException(OrganizationNotFoundMessage);
    }

    /// <summary>Non-members get 404; active members without the Admin/Owner role get 403 with <paramref name="forbiddenMessage"/>.</summary>
    public static async Task<OrganizationMembership> RequireAdminOrOwner(
        this ApplicationDbContext context,
        Guid userId,
        Guid organizationId,
        string forbiddenMessage,
        CancellationToken cancellationToken = default)
    {
        var membership = await context.RequireActiveMember(userId, organizationId, cancellationToken);
        if (!IsAdminOrOwnerRole(membership.Role))
        {
            throw new ForbiddenException(forbiddenMessage);
        }

        return membership;
    }

    /// <summary>Non-members get 404; active members who are not the Owner get 403 with <paramref name="forbiddenMessage"/>.</summary>
    public static async Task<OrganizationMembership> RequireOwner(
        this ApplicationDbContext context,
        Guid userId,
        Guid organizationId,
        string forbiddenMessage,
        CancellationToken cancellationToken = default)
    {
        var membership = await context.RequireActiveMember(userId, organizationId, cancellationToken);
        if (membership.Role != OrganizationRoles.Owner)
        {
            throw new ForbiddenException(forbiddenMessage);
        }

        return membership;
    }
}
