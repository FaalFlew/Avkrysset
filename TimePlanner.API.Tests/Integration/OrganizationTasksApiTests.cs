using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace TimePlanner.API.Tests.Integration;

/// <summary>Organization task endpoints (docs/plans/organizations-phase3.md §2.5): task by id and assignee ids.</summary>
[Collection(ApiCollection.Name)]
public sealed class OrganizationTasksApiTests
{
    private readonly ApiFixture _fixture;

    public OrganizationTasksApiTests(ApiFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task A_member_can_read_only_tasks_assigned_to_or_created_by_them()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var adminsOwn = await OrgTestKit.CreateOrgTaskAsync(org.Admin, org.OrgId, "Admin only", "2026-11-02T09:00:00.000Z", 1, org.Admin);
        var assigned = await OrgTestKit.CreateOrgTaskAsync(org.Admin, org.OrgId, "For the member", "2026-11-02T10:00:00.000Z", 1, org.Member);
        var ownTask = await OrgTestKit.CreateSelfOrgTaskAsync(org.Member, org.OrgId, "Mine", "2026-11-02T11:00:00.000Z", 1);

        var hidden = await org.Member.Client.GetAsync(TaskUrl(org, adminsOwn));
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        Assert.Equal("Task not found in this organization.", await OrgTestKit.ReadMessageAsync(hidden));

        var readOnly = await TaskAsync(org.Member, org, assigned);
        Assert.Equal("For the member", readOnly.GetProperty("title").GetString());
        Assert.Equal((false, false, false), Capabilities(readOnly));

        Assert.Equal((true, true, false), Capabilities(await TaskAsync(org.Member, org, ownTask)));

        var asOwner = await TaskAsync(org.Owner, org, adminsOwn);
        Assert.Equal((true, true, true), Capabilities(asOwner));
        Assert.Equal(org.OrgId, asOwner.GetProperty("organizationId").GetGuid());
        Assert.Equal(org.Admin.Id, asOwner.GetProperty("createdBy").GetProperty("userId").GetGuid());

        // Another organization's task id through this organization is 404 for its admins too.
        var other = await OrgTestKit.CreateAsync(_fixture);
        var foreign = await OrgTestKit.CreateOrgTaskAsync(other.Owner, other.OrgId, "Elsewhere", "2026-11-02T09:00:00.000Z", 1, other.Owner);
        Assert.Equal(HttpStatusCode.NotFound, (await org.Owner.Client.GetAsync(TaskUrl(org, foreign))).StatusCode);
    }

    [Fact]
    public async Task Created_tasks_point_at_their_by_id_route()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);

        var created = await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/tasks", new
        {
            organizationId = org.OrgId, title = "Review", start = "2026-11-03T09:00:00.000Z", duration = 1.5,
            categoryId = org.Owner.CategoryId, assigneeIds = new[] { org.Member.Id }
        });
        var id = (await OrgTestKit.ReadJsonAsync(created, HttpStatusCode.Created)).GetProperty("id").GetGuid();

        var fetched = await OrgTestKit.ReadJsonAsync(await org.Member.Client.GetAsync(created.Headers.Location), HttpStatusCode.OK);
        Assert.Equal(id, fetched.GetProperty("id").GetGuid());
        Assert.Equal("2026-11-03T09:00:00.000Z", fetched.GetProperty("start").GetString());
    }

    [Fact]
    public async Task Repeated_assignee_ids_count_once()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);

        var task = await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/tasks", new
        {
            organizationId = org.OrgId, title = "Pair", start = "2026-11-03T09:00:00.000Z", duration = 1,
            categoryId = org.Owner.CategoryId, assigneeIds = new[] { org.Member.Id, org.Member.Id, org.Admin.Id }
        }), HttpStatusCode.Created);
        Assert.Equal(2, task.GetProperty("assignees").GetArrayLength());

        var panel = (await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issue-panels",
            new { organizationId = org.OrgId, name = "Backlog" }), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var issue = (await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issue-panels/{panel}/issues",
            new { organizationId = org.OrgId, panelId = panel, title = "Bug", notes = (string?)null, categoryId = org.Owner.CategoryId }),
            HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var promoted = await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issues/{issue}/promote-to-task",
            new { organizationId = org.OrgId, issueId = issue, start = "2026-11-03T11:00:00.000Z", duration = 1, assigneeIds = new[] { org.Member.Id, org.Member.Id } }),
            HttpStatusCode.Created);
        Assert.Equal(1, promoted.GetProperty("assignees").GetArrayLength());
    }

    private static string TaskUrl(OrgSetup org, Guid taskId) => $"/api/organizations/{org.OrgId}/tasks/{taskId}";

    private static async Task<JsonElement> TaskAsync(TestUser user, OrgSetup org, Guid taskId) =>
        await OrgTestKit.ReadJsonAsync(await user.Client.GetAsync(TaskUrl(org, taskId)), HttpStatusCode.OK);

    private static (bool CanEdit, bool CanDelete, bool CanReassign) Capabilities(JsonElement task)
    {
        var c = task.GetProperty("capabilities");
        return (c.GetProperty("canEdit").GetBoolean(), c.GetProperty("canDelete").GetBoolean(), c.GetProperty("canReassign").GetBoolean());
    }
}
