using System.Linq.Expressions;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Models.Organization;

namespace TimePlanner.API.Features.Queries.Organizations;

/// <summary>Invitation DTOs and the rules shared by accept, decline and rescind.</summary>
public static class InvitationProjections
{
    public const string NotFoundMessage = "Invitation not found.";
    public const string ExpiredMessage = "This invitation has expired.";

    /// <summary>The invitation as a DTO; a pending invitation past its expiry reads "Expired".</summary>
    public static Expression<Func<OrganizationInvitation, OrganizationInvitationDto>> ToDto(DateTime nowUtc) => i => new OrganizationInvitationDto
    {
        Id = i.Id,
        OrganizationId = i.OrganizationId,
        OrganizationName = i.Organization.Name,
        InvitedUserEmail = i.InvitedUserEmail,
        Role = i.Role,
        Status = i.Status == InvitationStatus.Pending && i.ExpiryUtc <= nowUtc ? InvitationStatus.Expired : i.Status,
        ExpiryUtc = i.ExpiryUtc,
        InvitedByDisplayName = i.Inviter.DisplayName ?? i.Inviter.Email!,
        CreatedOnUtc = i.CreatedOnUtc
    };

    /// <summary>The status a client sees: a pending invitation past its expiry is "Expired".</summary>
    public static string EffectiveStatus(string status, DateTime expiryUtc, DateTime nowUtc) =>
        status == InvitationStatus.Pending && expiryUtc <= nowUtc ? InvitationStatus.Expired : status;

    /// <summary>409 for an invitation that was already answered or withdrawn ("This invitation has already been declined.").</summary>
    public static ConflictException AlreadyAnswered(string status) =>
        new($"This invitation has already been {status.ToLowerInvariant()}.");

    /// <summary>"m•••@gmail.com": the first character, three bullets, then the domain.</summary>
    public static string MaskEmail(string email)
    {
        const string bullets = "\u2022\u2022\u2022";
        var at = email.LastIndexOf('@');
        return at <= 0
            ? (email.Length > 0 ? email[..1] : string.Empty) + bullets
            : email[..1] + bullets + email[at..];
    }
}
