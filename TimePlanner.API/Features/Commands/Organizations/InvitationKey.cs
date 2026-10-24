using TimePlanner.API.Models.Organization;

namespace TimePlanner.API.Features.Commands.Organizations;

/// <summary>
/// Which invitation a request is about: the secret token from the email link, or the id shown in the signed-in
/// invitee's inbox (the inbox never sees tokens).
/// </summary>
public sealed record InvitationKey
{
    private InvitationKey(string? token, Guid? id)
    {
        Token = token;
        Id = id;
    }

    public string? Token { get; }
    public Guid? Id { get; }

    public static InvitationKey ForToken(string token) => new(token, null);
    public static InvitationKey ForId(Guid id) => new(null, id);

    public IQueryable<OrganizationInvitation> Filter(IQueryable<OrganizationInvitation> invitations)
    {
        if (Token is { } token)
        {
            return invitations.Where(i => i.Token == token);
        }

        var id = Id!.Value;
        return invitations.Where(i => i.Id == id);
    }
}
