using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>One SQL projection from <see cref="OrganizationMembership"/> to <see cref="OrganizationMembershipDto"/>.</summary>
public static class MembershipProjections
{
    public static readonly Expression<Func<OrganizationMembership, OrganizationMembershipDto>> ToDto = m => new OrganizationMembershipDto
    {
        MembershipId = m.Id,
        OrganizationId = m.OrganizationId,
        OrganizationName = m.Organization.Name,
        UserId = m.UserId,
        UserEmail = m.User.Email!,
        DisplayName = m.User.DisplayName ?? m.User.Email!,
        Role = m.Role,
        Status = m.Status,
        StatusMessage = m.StatusMessage
    };

    /// <summary>Loads one membership as a DTO in a single query.</summary>
    public static Task<OrganizationMembershipDto> LoadAsync(ApplicationDbContext context, Guid membershipId, CancellationToken cancellationToken) =>
        context.OrganizationMemberships.AsNoTracking().Where(m => m.Id == membershipId).Select(ToDto).SingleAsync(cancellationToken);
}
