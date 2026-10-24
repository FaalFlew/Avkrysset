using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TimePlanner.API.Data;
using TimePlanner.API.Models.Organization;

namespace TimePlanner.API.Tests.Integration;

/// <summary>
/// Invitations (docs/plans/organizations-phase3.md §2.4): invite / re-invite / expiry, accept and decline by token and
/// by id, rescind, the preview, and the regression where accepting while already active overwrote the role.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class InvitationApiTests
{
    private readonly ApiFixture _fixture;

    public InvitationApiTests(ApiFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Inviting_twice_or_inviting_an_active_member_is_409()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var invitee = await _fixture.CreateUserAsync();

        var created = await InviteAsync(org.Admin, org.OrgId, $"  {invitee.Email}  ", "Member");
        var invitation = await OrgTestKit.ReadJsonAsync(created, HttpStatusCode.Created);
        Assert.Equal(invitee.Email, invitation.GetProperty("invitedUserEmail").GetString()); // trimmed
        Assert.Equal("Pending", invitation.GetProperty("status").GetString());
        Assert.Equal(org.Admin.Email, invitation.GetProperty("invitedByDisplayName").GetString());
        Assert.EndsWith("Z", invitation.GetProperty("createdOnUtc").GetString());
        // Location is the by-id route (it used to point at a stub).
        Assert.Equal($"/api/invitations/{invitation.GetProperty("id").GetGuid()}", created.Headers.Location?.AbsolutePath, ignoreCase: true);

        var again = await InviteAsync(org.Owner, org.OrgId, invitee.Email.ToUpperInvariant(), "Admin");
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal($"'{invitee.Email.ToUpperInvariant()}' already has a pending invitation to this organization.", await OrgTestKit.ReadMessageAsync(again));

        var member = await InviteAsync(org.Owner, org.OrgId, org.Member.Email, "Member");
        Assert.Equal(HttpStatusCode.Conflict, member.StatusCode);
    }

    [Fact]
    public async Task An_expired_pending_invitation_no_longer_blocks_a_new_one()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var email = $"later-{Guid.NewGuid():N}@tests.local";
        var first = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, email, "Member"));
        await ExpireAsync(first);

        var second = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, email, "Admin"));

        Assert.Equal(InvitationStatus.Expired, await ReadAsync(first, i => i.Status));
        Assert.Equal(InvitationStatus.Pending, await ReadAsync(second, i => i.Status));
        var pending = await OrgTestKit.ReadJsonAsync(await org.Admin.Client.GetAsync($"/api/organizations/{org.OrgId}/invitations"), HttpStatusCode.OK);
        Assert.Equal(new[] { second }, pending.EnumerateArray().Select(i => i.GetProperty("id").GetGuid()));
    }

    [Fact]
    public async Task The_email_links_to_the_invitation_page_and_encodes_the_organization_name()
    {
        var owner = await _fixture.CreateUserAsync();
        var name = $"<b>Acme</b> & \"Co\" {Guid.NewGuid():N}";
        var orgId = (await OrgTestKit.ReadJsonAsync(
            await owner.Client.PostAsJsonAsync("/api/organizations", new { name }), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var email = $"mail-{Guid.NewGuid():N}@tests.local";

        var invitationId = await InvitationIdAsync(await InviteAsync(owner, orgId, email, "Member"));

        var sent = Assert.Single(_fixture.Emails.SentTo(email));
        var token = await ReadAsync(invitationId, i => i.Token);
        Assert.Contains($"/invitations/{token}\"", sent.HtmlBody);
        Assert.DoesNotContain("accept-invite", sent.HtmlBody);
        Assert.DoesNotContain("<b>Acme</b>", sent.HtmlBody);
        Assert.Contains("&lt;b&gt;Acme&lt;/b&gt; &amp; &quot;Co&quot;", sent.HtmlBody);
    }

    [Fact]
    public async Task Invitations_can_be_accepted_by_token_and_by_inbox_id_once()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var byToken = await _fixture.CreateUserAsync();
        var byId = await _fixture.CreateUserAsync();
        var tokenInvitation = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, byToken.Email, "Admin"));
        var idInvitation = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, byId.Email, "Member"));
        var token = await ReadAsync(tokenInvitation, i => i.Token);

        var viaToken = await OrgTestKit.ReadJsonAsync(await byToken.Client.PostAsync($"/api/invitations/{token}/accept", null), HttpStatusCode.OK);
        Assert.Equal(("Admin", "Active", org.OrgId), (viaToken.GetProperty("role").GetString(), viaToken.GetProperty("status").GetString(), viaToken.GetProperty("organizationId").GetGuid()));

        var inbox = await OrgTestKit.ReadJsonAsync(await byId.Client.GetAsync("/api/users/me/invitations"), HttpStatusCode.OK);
        Assert.Equal(new[] { idInvitation }, inbox.EnumerateArray().Select(i => i.GetProperty("id").GetGuid()));
        var viaId = await OrgTestKit.ReadJsonAsync(await byId.Client.PostAsync($"/api/invitations/{idInvitation}/accept", null), HttpStatusCode.OK);
        Assert.Equal("Member", viaId.GetProperty("role").GetString());
        Assert.Empty((await OrgTestKit.ReadJsonAsync(await byId.Client.GetAsync("/api/users/me/invitations"), HttpStatusCode.OK)).EnumerateArray());

        var twice = await byId.Client.PostAsync($"/api/invitations/{idInvitation}/accept", null);
        Assert.Equal(HttpStatusCode.Conflict, twice.StatusCode);
        Assert.Equal("This invitation has already been accepted.", await OrgTestKit.ReadMessageAsync(twice));
    }

    [Fact]
    public async Task Someone_else_gets_404_by_token_and_by_id()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var invitee = await _fixture.CreateUserAsync();
        var invitationId = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, invitee.Email, "Member"));
        var token = await ReadAsync(invitationId, i => i.Token);

        foreach (var url in new[]
                 {
                     $"/api/invitations/{token}/accept", $"/api/invitations/{invitationId}/accept",
                     $"/api/invitations/{invitationId}/decline"
                 })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await org.Outsider.Client.PostAsync(url, null)).StatusCode);
        }

        // The invitation by id: the invitee and the organization's admins, nobody else (not even plain members).
        Assert.Equal(HttpStatusCode.NotFound, (await org.Outsider.Client.GetAsync($"/api/invitations/{invitationId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await org.Member.Client.GetAsync($"/api/invitations/{invitationId}")).StatusCode);
        foreach (var viewer in new[] { invitee, org.Admin })
        {
            var dto = await OrgTestKit.ReadJsonAsync(await viewer.Client.GetAsync($"/api/invitations/{invitationId}"), HttpStatusCode.OK);
            Assert.Equal(invitee.Email, dto.GetProperty("invitedUserEmail").GetString());
        }

        Assert.Equal(InvitationStatus.Pending, await ReadAsync(invitationId, i => i.Status));
        Assert.Equal(HttpStatusCode.NotFound, (await invitee.Client.PostAsync($"/api/invitations/{Guid.NewGuid()}/accept", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await invitee.Client.PostAsync("/api/invitations/not-a-real-token/accept", null)).StatusCode);
    }

    [Fact]
    public async Task Guid_routes_take_ids_and_other_routes_take_tokens()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var invitee = await _fixture.CreateUserAsync();
        var invitationId = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, invitee.Email, "Member"));
        var token = await ReadAsync(invitationId, i => i.Token);
        Assert.Equal(43, token.Length);
        Assert.False(Guid.TryParse(token, out _));

        var byId = await OrgTestKit.ReadJsonAsync(await invitee.Client.GetAsync($"/api/invitations/{invitationId}"), HttpStatusCode.OK);
        Assert.Equal(invitationId, byId.GetProperty("id").GetGuid());
        Assert.False(byId.TryGetProperty("invitedEmailMasked", out _));

        var preview = await OrgTestKit.ReadJsonAsync(await invitee.Client.GetAsync($"/api/invitations/{token}"), HttpStatusCode.OK);
        Assert.Equal(org.OrgId, preview.GetProperty("organizationId").GetGuid());
        Assert.Equal(org.OrgName, preview.GetProperty("organizationName").GetString());
        Assert.Equal(invitee.Email[..1] + "•••@tests.local", preview.GetProperty("invitedEmailMasked").GetString());
        Assert.Equal("Pending", preview.GetProperty("status").GetString());
        Assert.True(preview.GetProperty("matchesCurrentUser").GetBoolean());
        Assert.False((await OrgTestKit.ReadJsonAsync(await org.Outsider.Client.GetAsync($"/api/invitations/{token}"), HttpStatusCode.OK))
            .GetProperty("matchesCurrentUser").GetBoolean());
        Assert.False(preview.TryGetProperty("invitedUserEmail", out _));

        Assert.Equal(HttpStatusCode.NotFound, (await invitee.Client.GetAsync("/api/invitations/unknown-token")).StatusCode);
    }

    [Fact]
    public async Task Accepting_while_already_active_keeps_the_role_even_for_the_owner()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var codes = await OrgTestKit.ReadJsonAsync(await org.Owner.Client.GetAsync($"/api/organizations/{org.OrgId}/join-codes"), HttpStatusCode.OK);
        var newcomer = await _fixture.CreateUserAsync();

        // Invited as a Member, joins by the admin code meanwhile, then becomes the owner.
        var invitationId = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, newcomer.Email, "Member"));
        await OrgTestKit.JoinAsync(newcomer, codes.GetProperty("adminJoinCode").GetString()!);
        Assert.Equal(HttpStatusCode.NoContent, (await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/transfer-ownership",
            new { organizationId = org.OrgId, newOwnerUserId = newcomer.Id })).StatusCode);
        var before = _fixture.Notifications.EventsFor(org.OrgId).Length;

        var accepted = await OrgTestKit.ReadJsonAsync(await newcomer.Client.PostAsync($"/api/invitations/{invitationId}/accept", null), HttpStatusCode.OK);

        Assert.Equal("Owner", accepted.GetProperty("role").GetString());
        Assert.Equal(InvitationStatus.Accepted, await ReadAsync(invitationId, i => i.Status));
        var organization = await OrgTestKit.ReadJsonAsync(await newcomer.Client.GetAsync($"/api/organizations/{org.OrgId}"), HttpStatusCode.OK);
        Assert.Equal((newcomer.Id, "Owner"), (organization.GetProperty("ownerId").GetGuid(), organization.GetProperty("myRole").GetString()));
        Assert.Empty(_fixture.Notifications.EventsFor(org.OrgId).Skip(before)); // nobody joined

        // Same for an admin invited as a Member: no demotion.
        var admin = await _fixture.CreateUserAsync();
        var adminInvite = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, admin.Email, "Member"));
        await OrgTestKit.JoinAsync(admin, codes.GetProperty("adminJoinCode").GetString()!);
        var token = await ReadAsync(adminInvite, i => i.Token);
        Assert.Equal("Admin", (await OrgTestKit.ReadJsonAsync(await admin.Client.PostAsync($"/api/invitations/{token}/accept", null), HttpStatusCode.OK))
            .GetProperty("role").GetString());
    }

    [Fact]
    public async Task Rescinded_invitations_leave_the_list_and_cannot_be_accepted()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var other = await OrgTestKit.CreateAsync(_fixture);
        var invitee = await _fixture.CreateUserAsync();
        var invitationId = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, invitee.Email, "Member"));

        // Another organization's admin can't touch it through their own organization.
        Assert.Equal(HttpStatusCode.NotFound, (await other.Owner.Client.DeleteAsync($"/api/organizations/{other.OrgId}/invitations/{invitationId}")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await org.Admin.Client.DeleteAsync($"/api/organizations/{org.OrgId}/invitations/{invitationId}")).StatusCode);

        Assert.Equal(InvitationStatus.Rescinded, await ReadAsync(invitationId, i => i.Status));
        Assert.Empty((await OrgTestKit.ReadJsonAsync(await org.Owner.Client.GetAsync($"/api/organizations/{org.OrgId}/invitations"), HttpStatusCode.OK)).EnumerateArray());
        Assert.Empty((await OrgTestKit.ReadJsonAsync(await invitee.Client.GetAsync("/api/users/me/invitations"), HttpStatusCode.OK)).EnumerateArray());

        var accept = await invitee.Client.PostAsync($"/api/invitations/{invitationId}/accept", null);
        Assert.Equal(HttpStatusCode.Conflict, accept.StatusCode);
        Assert.Equal("This invitation has already been rescinded.", await OrgTestKit.ReadMessageAsync(accept));
        Assert.Equal(HttpStatusCode.Conflict, (await org.Owner.Client.DeleteAsync($"/api/organizations/{org.OrgId}/invitations/{invitationId}")).StatusCode);
    }

    [Fact]
    public async Task Expired_invitations_are_400_to_accept_or_decline_and_read_as_expired()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var invitee = await _fixture.CreateUserAsync();
        var invitationId = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, invitee.Email, "Member"));
        var token = await ReadAsync(invitationId, i => i.Token);
        await ExpireAsync(invitationId);

        var preview = await OrgTestKit.ReadJsonAsync(await invitee.Client.GetAsync($"/api/invitations/{token}"), HttpStatusCode.OK);
        Assert.Equal("Expired", preview.GetProperty("status").GetString());

        foreach (var url in new[] { $"/api/invitations/{token}/accept", $"/api/invitations/{invitationId}/decline", $"/api/invitations/{token}/decline" })
        {
            var response = await invitee.Client.PostAsync(url, null);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("This invitation has expired.", await OrgTestKit.ReadMessageAsync(response));
        }

        Assert.Equal(InvitationStatus.Expired, await ReadAsync(invitationId, i => i.Status));
        Assert.Equal(HttpStatusCode.Conflict, (await org.Owner.Client.DeleteAsync($"/api/organizations/{org.OrgId}/invitations/{invitationId}")).StatusCode);
    }

    [Fact]
    public async Task Declined_invitations_cannot_be_accepted_afterwards()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var invitee = await _fixture.CreateUserAsync();
        var byId = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, invitee.Email, "Member"));

        Assert.Equal(HttpStatusCode.NoContent, (await invitee.Client.PostAsync($"/api/invitations/{byId}/decline", null)).StatusCode);

        Assert.Equal(InvitationStatus.Declined, await ReadAsync(byId, i => i.Status));
        var accept = await invitee.Client.PostAsync($"/api/invitations/{byId}/accept", null);
        Assert.Equal(HttpStatusCode.Conflict, accept.StatusCode);
        Assert.Equal("This invitation has already been declined.", await OrgTestKit.ReadMessageAsync(accept));
        Assert.Equal(HttpStatusCode.NotFound, (await invitee.Client.GetAsync($"/api/organizations/{org.OrgId}")).StatusCode);

        // A new invitation after a decline is allowed (a decline doesn't block the address), and declines by token.
        var byToken = await InvitationIdAsync(await InviteAsync(org.Owner, org.OrgId, invitee.Email, "Member"));
        var token = await ReadAsync(byToken, i => i.Token);
        Assert.Equal(HttpStatusCode.NoContent, (await invitee.Client.PostAsync($"/api/invitations/{token}/decline", null)).StatusCode);
        Assert.Equal(InvitationStatus.Declined, await ReadAsync(byToken, i => i.Status));
    }

    // --- Helpers ---

    private static Task<HttpResponseMessage> InviteAsync(TestUser inviter, Guid orgId, string email, string role) =>
        inviter.Client.PostAsJsonAsync($"/api/organizations/{orgId}/invitations", new { organizationId = orgId, email, role });

    private static async Task<Guid> InvitationIdAsync(HttpResponseMessage response) =>
        (await OrgTestKit.ReadJsonAsync(response, HttpStatusCode.Created)).GetProperty("id").GetGuid();

    private async Task<T> ReadAsync<T>(Guid invitationId, System.Linq.Expressions.Expression<Func<OrganizationInvitation, T>> select)
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        return await db.OrganizationInvitations.AsNoTracking().Where(i => i.Id == invitationId).Select(select).SingleAsync();
    }

    private async Task ExpireAsync(Guid invitationId)
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        await db.OrganizationInvitations.Where(i => i.Id == invitationId)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.ExpiryUtc, DateTime.UtcNow.AddMinutes(-1)));
    }
}
