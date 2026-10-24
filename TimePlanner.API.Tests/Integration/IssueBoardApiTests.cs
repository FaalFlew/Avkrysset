using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace TimePlanner.API.Tests.Integration;

/// <summary>The board contract (docs/plans/organizations-phase3.md §2.6) and the cross-organization DeleteIssue fix.</summary>
[Collection(ApiCollection.Name)]
public sealed class IssueBoardApiTests
{
    private readonly ApiFixture _fixture;

    public IssueBoardApiTests(ApiFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task An_admin_cannot_delete_another_organizations_issue_through_their_own_organization()
    {
        var mine = await OrgTestKit.CreateAsync(_fixture);
        var theirs = await OrgTestKit.CreateAsync(_fixture);
        var theirPanel = await CreatePanelAsync(theirs.Owner, theirs.OrgId, "Backlog");
        var theirIssue = await CreateIssueAsync(theirs.Owner, theirs.OrgId, theirPanel, "Their issue");

        var response = await mine.Admin.Client.DeleteAsync($"/api/organizations/{mine.OrgId}/issue-panels/{theirPanel}/issues/{theirIssue}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var board = await BoardAsync(theirs.Member, theirs.OrgId);
        Assert.Contains(theirIssue, IssueIds(board, theirPanel));

        // Through its own organization it can be deleted.
        Assert.Equal(HttpStatusCode.NoContent,
            (await theirs.Admin.Client.DeleteAsync($"/api/organizations/{theirs.OrgId}/issue-panels/{theirPanel}/issues/{theirIssue}")).StatusCode);
        Assert.Empty(IssueIds(await BoardAsync(theirs.Member, theirs.OrgId), theirPanel));
    }

    [Fact]
    public async Task The_board_orders_panels_and_issues_by_age_and_shows_scheduled_issues_on_request()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var first = await CreatePanelAsync(org.Owner, org.OrgId, "Zeta");
        var second = await CreatePanelAsync(org.Admin, org.OrgId, "Alpha");
        var a = await CreateIssueAsync(org.Owner, org.OrgId, first, "A");
        var b = await CreateIssueAsync(org.Owner, org.OrgId, first, "B");
        var c = await CreateIssueAsync(org.Admin, org.OrgId, first, "C");
        var taskId = (await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync(
                $"/api/organizations/{org.OrgId}/issues/{b}/promote-to-task",
                new { organizationId = org.OrgId, issueId = b, start = "2026-11-04T09:00:00.000Z", duration = 1, assigneeIds = new[] { org.Member.Id } }),
            HttpStatusCode.Created)).GetProperty("id").GetGuid();

        var board = await BoardAsync(org.Member, org.OrgId);
        Assert.Equal(new[] { first, second }, board.GetProperty("panels").EnumerateArray().Select(p => p.GetProperty("id").GetGuid()));
        Assert.Equal(new[] { a, c }, IssueIds(board, first));

        var scheduled = await OrgTestKit.ReadJsonAsync(
            await org.Member.Client.GetAsync($"/api/organizations/{org.OrgId}/issue-board?includeScheduled=true"), HttpStatusCode.OK);
        Assert.Equal(new[] { a, b, c }, IssueIds(scheduled, first));
        var issues = Panel(scheduled, first).GetProperty("issues").EnumerateArray().ToDictionary(i => i.GetProperty("id").GetGuid());
        Assert.Equal(taskId, issues[b].GetProperty("convertedToTaskId").GetGuid());
        Assert.Equal(JsonValueKind.Null, issues[a].GetProperty("convertedToTaskId").ValueKind);
        Assert.Equal("#3366FF", issues[a].GetProperty("categoryColor").GetString()); // the creator's category colour
        Assert.EndsWith("Z", issues[a].GetProperty("createdOnUtc").GetString());
    }

    [Fact]
    public async Task Promoted_issues_cannot_be_moved()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var from = await CreatePanelAsync(org.Owner, org.OrgId, "Backlog");
        var to = await CreatePanelAsync(org.Owner, org.OrgId, "Doing");
        var issue = await CreateIssueAsync(org.Owner, org.OrgId, from, "Ship it");
        await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issues/{issue}/promote-to-task",
            new { organizationId = org.OrgId, issueId = issue, start = "2026-11-04T09:00:00.000Z", duration = 1, assigneeIds = new[] { org.Owner.Id } }),
            HttpStatusCode.Created);

        var move = await org.Admin.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/issues/{issue}/move",
            new { organizationId = org.OrgId, issueId = issue, newPanelId = to });

        Assert.Equal(HttpStatusCode.Conflict, move.StatusCode);
        var board = await OrgTestKit.ReadJsonAsync(
            await org.Owner.Client.GetAsync($"/api/organizations/{org.OrgId}/issue-board?includeScheduled=true"), HttpStatusCode.OK);
        Assert.Equal(new[] { issue }, IssueIds(board, from));
    }

    [Fact]
    public async Task Panel_names_are_unique_per_organization_and_renames_are_validated()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        await CreatePanelAsync(org.Owner, org.OrgId, "Backlog");
        var doing = await CreatePanelAsync(org.Owner, org.OrgId, "Doing");
        var url = $"/api/organizations/{org.OrgId}/issue-panels";

        var duplicate = await org.Admin.Client.PostAsJsonAsync(url, new { organizationId = org.OrgId, name = "Backlog" });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.Equal("An issue panel with the name 'Backlog' already exists in this organization.", await OrgTestKit.ReadMessageAsync(duplicate));

        Assert.Equal(HttpStatusCode.Conflict,
            (await org.Admin.Client.PutAsJsonAsync($"{url}/{doing}", new { organizationId = org.OrgId, panelId = doing, name = "Backlog" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await org.Admin.Client.PutAsJsonAsync($"{url}/{doing}", new { organizationId = org.OrgId, panelId = doing, name = "" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await org.Admin.Client.PutAsJsonAsync($"{url}/{doing}", new { organizationId = org.OrgId, panelId = doing, name = new string('x', 101) })).StatusCode);

        // Another organization may use the same name.
        var other = await OrgTestKit.CreateAsync(_fixture);
        await CreatePanelAsync(other.Owner, other.OrgId, "Backlog");
    }

    [Fact]
    public async Task Another_admin_can_edit_an_issue_that_keeps_the_creators_category()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var panel = await CreatePanelAsync(org.Owner, org.OrgId, "Backlog");
        var issue = await CreateIssueAsync(org.Owner, org.OrgId, panel, "Draft");
        var url = $"/api/organizations/{org.OrgId}/issue-panels/{panel}/issues/{issue}";

        var keep = await org.Admin.Client.PutAsJsonAsync(url,
            new { organizationId = org.OrgId, panelId = panel, issueId = issue, title = "Final", notes = "n", categoryId = org.Owner.CategoryId });
        Assert.Equal(HttpStatusCode.NoContent, keep.StatusCode);

        // Switching to someone else's category is still rejected.
        var foreign = await org.Admin.Client.PutAsJsonAsync(url,
            new { organizationId = org.OrgId, panelId = panel, issueId = issue, title = "Final", notes = "n", categoryId = org.Member.CategoryId });
        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);

        var dto = Panel(await BoardAsync(org.Admin, org.OrgId), panel).GetProperty("issues")[0];
        Assert.Equal(("Final", org.Owner.CategoryId), (dto.GetProperty("title").GetString(), dto.GetProperty("categoryId").GetGuid()));
    }

    // --- Helpers ---

    private static async Task<Guid> CreatePanelAsync(TestUser user, Guid orgId, string name) =>
        (await OrgTestKit.ReadJsonAsync(
            await user.Client.PostAsJsonAsync($"/api/organizations/{orgId}/issue-panels", new { organizationId = orgId, name }),
            HttpStatusCode.Created)).GetProperty("id").GetGuid();

    private static async Task<Guid> CreateIssueAsync(TestUser user, Guid orgId, Guid panelId, string title) =>
        (await OrgTestKit.ReadJsonAsync(
            await user.Client.PostAsJsonAsync($"/api/organizations/{orgId}/issue-panels/{panelId}/issues",
                new { organizationId = orgId, panelId, title, notes = (string?)null, categoryId = user.CategoryId }),
            HttpStatusCode.Created)).GetProperty("id").GetGuid();

    private static async Task<JsonElement> BoardAsync(TestUser user, Guid orgId) =>
        await OrgTestKit.ReadJsonAsync(await user.Client.GetAsync($"/api/organizations/{orgId}/issue-board"), HttpStatusCode.OK);

    private static JsonElement Panel(JsonElement board, Guid panelId) =>
        board.GetProperty("panels").EnumerateArray().Single(p => p.GetProperty("id").GetGuid() == panelId);

    private static Guid[] IssueIds(JsonElement board, Guid panelId) =>
        Panel(board, panelId).GetProperty("issues").EnumerateArray().Select(i => i.GetProperty("id").GetGuid()).ToArray();
}
