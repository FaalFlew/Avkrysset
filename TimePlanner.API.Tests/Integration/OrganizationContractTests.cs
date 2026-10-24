using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TimePlanner.API.Data;
using TimePlanner.API.Models;

namespace TimePlanner.API.Tests.Integration;

/// <summary>
/// Phase 3 contracts the organization frontend is built against (docs/plans/organizations-phase3.md §2.2–2.3):
/// OrganizationDto per role, the member directory, members/me and the role/re-join rules.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed partial class OrganizationContractTests
{
    private readonly ApiFixture _fixture;

    public OrganizationContractTests(ApiFixture fixture) => _fixture = fixture;

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")]
    private static partial Regex WireInstant();

    [Fact]
    public async Task Organization_dto_carries_my_role_and_shows_join_codes_to_owners_and_admins_only()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);

        foreach (var (user, role) in new[] { (org.Owner, "Owner"), (org.Admin, "Admin") })
        {
            var single = await GetOrgAsync(user, org.OrgId);
            var listed = await ListedOrgAsync(user, org.OrgId);
            foreach (var dto in new[] { single, listed })
            {
                Assert.Equal(role, dto.GetProperty("myRole").GetString());
                Assert.Matches("^[A-Z2-9]{8}$", dto.GetProperty("memberJoinCode").GetString());
                Assert.Matches("^[A-Z2-9]{8}$", dto.GetProperty("adminJoinCode").GetString());
                Assert.Matches(WireInstant(), dto.GetProperty("memberJoinCodeExpiryUtc").GetString());
                Assert.Matches(WireInstant(), dto.GetProperty("adminJoinCodeExpiryUtc").GetString());
            }
        }

        // Members can't see (or "hidden"-guess) the codes: null, not a placeholder string.
        foreach (var dto in new[] { await GetOrgAsync(org.Member, org.OrgId), await ListedOrgAsync(org.Member, org.OrgId) })
        {
            Assert.Equal("Member", dto.GetProperty("myRole").GetString());
            foreach (var field in new[] { "memberJoinCode", "memberJoinCodeExpiryUtc", "adminJoinCode", "adminJoinCodeExpiryUtc" })
            {
                Assert.Equal(JsonValueKind.Null, dto.GetProperty(field).ValueKind);
            }
        }

        // Admins can read the codes endpoint too (Q8), and its codes are the ones the owner sees.
        var owner = await GetOrgAsync(org.Owner, org.OrgId);
        var codes = await OrgTestKit.ReadJsonAsync(await org.Admin.Client.GetAsync($"/api/organizations/{org.OrgId}/join-codes"), HttpStatusCode.OK);
        Assert.Equal(owner.GetProperty("memberJoinCode").GetString(), codes.GetProperty("memberJoinCode").GetString());
        Assert.Equal(owner.GetProperty("adminJoinCode").GetString(), codes.GetProperty("adminJoinCode").GetString());
    }

    [Fact]
    public async Task Create_and_regenerate_return_the_owner_view()
    {
        var owner = await _fixture.CreateUserAsync();
        var created = await OrgTestKit.ReadJsonAsync(
            await owner.Client.PostAsJsonAsync("/api/organizations", new { name = $"Org {Guid.NewGuid():N}" }), HttpStatusCode.Created);
        Assert.Equal("Owner", created.GetProperty("myRole").GetString());
        Assert.NotEqual(JsonValueKind.Null, created.GetProperty("memberJoinCode").ValueKind);
        var orgId = created.GetProperty("id").GetGuid();

        var regenerated = await OrgTestKit.ReadJsonAsync(
            await owner.Client.PostAsJsonAsync($"/api/organizations/{orgId}/regenerate-codes", new { organizationId = orgId, expiryDays = 30 }),
            HttpStatusCode.OK);
        Assert.Equal("Owner", regenerated.GetProperty("myRole").GetString());
        Assert.NotEqual(created.GetProperty("memberJoinCode").GetString(), regenerated.GetProperty("memberJoinCode").GetString());
    }

    [Fact]
    public async Task Organization_color_is_the_color_its_tasks_get_in_personal_analytics()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Standup", "2026-11-03T09:00:00.000Z", 1, org.Member);

        var color = (await GetOrgAsync(org.Member, org.OrgId)).GetProperty("color").GetString();
        var analytics = await OrgTestKit.ReadJsonAsync(await org.Member.Client.GetAsync(
            "/api/tasks/analytics?startDate=2026-11-02T00:00:00.000Z&endDate=2026-11-09T00:00:00.000Z&viewType=daily"), HttpStatusCode.OK);

        var orgCategory = Assert.Single(analytics.GetProperty("timePerCategory").EnumerateArray());
        Assert.Matches("^#[0-9A-F]{6}$", color);
        Assert.Equal(color, orgCategory.GetProperty("categoryColor").GetString());
    }

    [Fact]
    public async Task Members_see_the_active_directory_and_owners_and_admins_also_see_former_members()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var leaver = await _fixture.CreateUserAsync();
        await OrgTestKit.JoinAsync(leaver, (await GetOrgAsync(org.Owner, org.OrgId)).GetProperty("memberJoinCode").GetString()!);
        Assert.Equal(HttpStatusCode.NoContent, (await leaver.Client.PostAsync($"/api/organizations/{org.OrgId}/members/me/leave", null)).StatusCode);

        var asMember = await DirectoryAsync(org.Member, org.OrgId);
        Assert.Equal(
            new[] { org.Owner.Id, org.Admin.Id, org.Member.Id }.OrderBy(id => id),
            asMember.Select(m => m.GetProperty("userId").GetGuid()).OrderBy(id => id));
        Assert.All(asMember, m => Assert.Equal("Active", m.GetProperty("status").GetString()));

        foreach (var viewer in new[] { org.Owner, org.Admin })
        {
            var full = await DirectoryAsync(viewer, org.OrgId);
            Assert.Equal(4, full.Count);
            Assert.Equal("Left", full.Single(m => m.GetProperty("userId").GetGuid() == leaver.Id).GetProperty("status").GetString());
        }
    }

    [Fact]
    public async Task Members_me_is_404_once_the_membership_is_no_longer_active()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var url = $"/api/organizations/{org.OrgId}/members/me";

        var me = await OrgTestKit.ReadJsonAsync(await org.Member.Client.GetAsync(url), HttpStatusCode.OK);
        Assert.Equal("Member", me.GetProperty("role").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await org.Admin.Client.DeleteAsync($"/api/organizations/{org.OrgId}/members/{org.Member.Id}")).StatusCode);

        var removed = await org.Member.Client.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, removed.StatusCode);
        Assert.Equal("Organization not found.", await OrgTestKit.ReadMessageAsync(removed));
    }

    [Fact]
    public async Task Role_changes_need_an_active_target()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        Assert.Equal(HttpStatusCode.NoContent, (await org.Member.Client.PostAsync($"/api/organizations/{org.OrgId}/members/me/leave", null)).StatusCode);

        var response = await org.Owner.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/members/{org.Member.Id}/role",
            new { organizationId = org.OrgId, userId = org.Member.Id, newRole = "Admin" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var former = (await DirectoryAsync(org.Owner, org.OrgId)).Single(m => m.GetProperty("userId").GetGuid() == org.Member.Id);
        Assert.Equal(("Member", "Left"), (former.GetProperty("role").GetString(), former.GetProperty("status").GetString()));
    }

    [Fact]
    public async Task Rejoining_by_code_is_announced_like_a_first_join()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var code = (await GetOrgAsync(org.Owner, org.OrgId)).GetProperty("memberJoinCode").GetString()!;
        Assert.Equal(HttpStatusCode.NoContent, (await org.Member.Client.PostAsync($"/api/organizations/{org.OrgId}/members/me/leave", null)).StatusCode);
        var before = _fixture.Notifications.EventsFor(org.OrgId).Length;

        var rejoined = await OrgTestKit.ReadJsonAsync(
            await org.Member.Client.PostAsJsonAsync("/api/organizations/join", new { joinCode = code }), HttpStatusCode.OK);

        Assert.Equal("Active", rejoined.GetProperty("status").GetString());
        Assert.Equal(org.Member.Email, rejoined.GetProperty("userEmail").GetString());
        Assert.Equal(new[] { "MemberJoined" }, _fixture.Notifications.EventsFor(org.OrgId).Skip(before));
    }

    [Fact]
    public async Task An_organization_with_a_board_tasks_invitations_and_exports_can_be_deleted()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var panelId = (await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issue-panels",
            new { organizationId = org.OrgId, name = "Backlog" }), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        Guid IssueId(JsonElement issue) => issue.GetProperty("id").GetGuid();
        var issues = new List<Guid>();
        foreach (var title in new[] { "Open", "Promoted" })
        {
            issues.Add(IssueId(await OrgTestKit.ReadJsonAsync(await org.Admin.Client.PostAsJsonAsync(
                $"/api/organizations/{org.OrgId}/issue-panels/{panelId}/issues",
                new { organizationId = org.OrgId, panelId, title, notes = (string?)null, categoryId = org.Admin.CategoryId }), HttpStatusCode.Created)));
        }

        await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issues/{issues[1]}/promote-to-task",
            new { organizationId = org.OrgId, issueId = issues[1], start = "2026-11-05T09:00:00.000Z", duration = 1, assigneeIds = new[] { org.Member.Id } }),
            HttpStatusCode.Created);
        await OrgTestKit.CreateOrgTaskAsync(org.Admin, org.OrgId, "Plan", "2026-11-05T11:00:00.000Z", 1, org.Member, org.Admin);
        await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/invitations",
            new { organizationId = org.OrgId, email = $"x-{Guid.NewGuid():N}@tests.local", role = "Member" }), HttpStatusCode.Created);
        using (var scope = _fixture.CreateScope())
        {
            // Organization report exports are written by Phase 4; insert one the way it will look.
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            db.ReportExports.Add(new ReportExport
            {
                DocumentId = $"TP-20261105-{Guid.NewGuid():N}"[..20], Kind = "Organization", Format = "pdf", RequestedByUserId = org.Owner.Id,
                OrganizationId = org.OrgId, RangeStartUtc = DateTime.UtcNow.AddDays(-7), RangeEndUtc = DateTime.UtcNow, ViewType = "weekly",
                TimeZoneId = "UTC", Culture = "invariant", ContentSha256 = new byte[32], CreatedOnUtc = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        Assert.Equal(HttpStatusCode.NoContent, (await org.Owner.Client.DeleteAsync($"/api/organizations/{org.OrgId}")).StatusCode);

        using (var scope = _fixture.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert.False(await db.Organizations.IgnoreQueryFilters().AnyAsync(o => o.Id == org.OrgId));
            Assert.Equal(0, await db.IssuePanels.IgnoreQueryFilters().CountAsync(p => p.OrganizationId == org.OrgId));
            Assert.Equal(0, await db.Issues.IgnoreQueryFilters().CountAsync(i => i.OrganizationId == org.OrgId));
            Assert.Equal(0, await db.Tasks.IgnoreQueryFilters().CountAsync(t => t.OrganizationId == org.OrgId));
            Assert.Equal(0, await db.OrganizationInvitations.IgnoreQueryFilters().CountAsync(i => i.OrganizationId == org.OrgId));
            Assert.Equal(0, await db.OrganizationMemberships.IgnoreQueryFilters().CountAsync(m => m.OrganizationId == org.OrgId));
            Assert.Equal(0, await db.ReportExports.CountAsync(e => e.OrganizationId == org.OrgId));
        }

        Assert.Equal(HttpStatusCode.NotFound, (await org.Member.Client.GetAsync($"/api/organizations/{org.OrgId}")).StatusCode);
    }

    private static async Task<JsonElement> GetOrgAsync(TestUser user, Guid orgId) =>
        await OrgTestKit.ReadJsonAsync(await user.Client.GetAsync($"/api/organizations/{orgId}"), HttpStatusCode.OK);

    private static async Task<JsonElement> ListedOrgAsync(TestUser user, Guid orgId)
    {
        var list = await OrgTestKit.ReadJsonAsync(await user.Client.GetAsync("/api/users/me/organizations"), HttpStatusCode.OK);
        return list.EnumerateArray().Single(o => o.GetProperty("id").GetGuid() == orgId);
    }

    private static async Task<List<JsonElement>> DirectoryAsync(TestUser user, Guid orgId) =>
        (await OrgTestKit.ReadJsonAsync(await user.Client.GetAsync($"/api/organizations/{orgId}/members"), HttpStatusCode.OK))
        .EnumerateArray().ToList();
}
