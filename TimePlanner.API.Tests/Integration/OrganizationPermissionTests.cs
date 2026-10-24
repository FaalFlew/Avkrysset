using System.Net;
using System.Net.Http.Json;

namespace TimePlanner.API.Tests.Integration;

/// <summary>
/// 401 = not signed in, 404 = not an active member ("Organization not found.", so the organization's
/// existence isn't revealed), 403 = active member without the required role.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class OrganizationPermissionTests
{
    private enum Level { Member, AdminOrOwner, Owner }

    private sealed record Endpoint(Level Level, HttpMethod Method, Func<OrgSetup, TestUser, string> Url, Func<OrgSetup, TestUser, object?> Body);

    private static readonly Guid PanelId = Guid.NewGuid();
    private static readonly Guid IssueId = Guid.NewGuid();
    private static readonly Guid TaskId = Guid.NewGuid();
    private const string Start = "2026-10-20T08:00:00.000Z";
    private const string Range = "startDate=2026-10-19T00:00:00.000Z&endDate=2026-10-26T00:00:00.000Z";

    private static readonly Dictionary<string, Endpoint> Endpoints = new()
    {
        // Owner/Admin only
        ["create panel"] = new(Level.AdminOrOwner, HttpMethod.Post, (o, _) => $"/api/organizations/{o.OrgId}/issue-panels",
            (o, _) => new { organizationId = o.OrgId, name = "Backlog" }),
        ["create issue"] = new(Level.AdminOrOwner, HttpMethod.Post, (o, _) => $"/api/organizations/{o.OrgId}/issue-panels/{PanelId}/issues",
            (o, u) => new { organizationId = o.OrgId, panelId = PanelId, title = "Issue", notes = (string?)null, categoryId = u.CategoryId }),
        ["update issue"] = new(Level.AdminOrOwner, HttpMethod.Put, (o, _) => $"/api/organizations/{o.OrgId}/issue-panels/{PanelId}/issues/{IssueId}",
            (o, u) => new { organizationId = o.OrgId, panelId = PanelId, issueId = IssueId, title = "Issue", notes = (string?)null, categoryId = u.CategoryId }),
        ["delete issue"] = new(Level.AdminOrOwner, HttpMethod.Delete, (o, _) => $"/api/organizations/{o.OrgId}/issue-panels/{PanelId}/issues/{IssueId}", (_, _) => null),
        ["update panel"] = new(Level.AdminOrOwner, HttpMethod.Put, (o, _) => $"/api/organizations/{o.OrgId}/issue-panels/{PanelId}",
            (o, _) => new { organizationId = o.OrgId, panelId = PanelId, name = "Renamed" }),
        ["delete panel"] = new(Level.AdminOrOwner, HttpMethod.Delete, (o, _) => $"/api/organizations/{o.OrgId}/issue-panels/{PanelId}", (_, _) => null),
        ["move issue"] = new(Level.AdminOrOwner, HttpMethod.Put, (o, _) => $"/api/organizations/{o.OrgId}/issues/{IssueId}/move",
            (o, _) => new { organizationId = o.OrgId, issueId = IssueId, newPanelId = PanelId }),
        ["promote issue"] = new(Level.AdminOrOwner, HttpMethod.Post, (o, _) => $"/api/organizations/{o.OrgId}/issues/{IssueId}/promote-to-task",
            (o, _) => new { organizationId = o.OrgId, issueId = IssueId, start = Start, duration = 1, assigneeIds = new[] { o.Member.Id } }),
        ["create org task"] = new(Level.AdminOrOwner, HttpMethod.Post, (o, _) => $"/api/organizations/{o.OrgId}/tasks",
            (o, u) => new { organizationId = o.OrgId, title = "Task", start = Start, duration = 1, categoryId = u.CategoryId, assigneeIds = new[] { o.Member.Id } }),
        ["reassign task"] = new(Level.AdminOrOwner, HttpMethod.Put, (o, _) => $"/api/organizations/{o.OrgId}/tasks/{TaskId}/assignees",
            (o, _) => new { organizationId = o.OrgId, taskId = TaskId, newAssigneeIds = new[] { o.Member.Id } }),
        ["invite"] = new(Level.AdminOrOwner, HttpMethod.Post, (o, _) => $"/api/organizations/{o.OrgId}/invitations",
            (o, _) => new { organizationId = o.OrgId, email = "someone@tests.local", role = "Member" }),
        ["invitations"] = new(Level.AdminOrOwner, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/invitations", (_, _) => null),
        ["rescind invitation"] = new(Level.AdminOrOwner, HttpMethod.Delete, (o, _) => $"/api/organizations/{o.OrgId}/invitations/{IssueId}", (_, _) => null),
        ["remove member"] = new(Level.AdminOrOwner, HttpMethod.Delete, (o, _) => $"/api/organizations/{o.OrgId}/members/{o.Admin.Id}", (_, _) => null),
        ["change role"] = new(Level.AdminOrOwner, HttpMethod.Put, (o, _) => $"/api/organizations/{o.OrgId}/members/{o.Admin.Id}/role",
            (o, _) => new { organizationId = o.OrgId, userId = o.Admin.Id, newRole = "Member" }),
        ["update organization"] = new(Level.AdminOrOwner, HttpMethod.Put, (o, _) => $"/api/organizations/{o.OrgId}",
            (o, _) => new { organizationId = o.OrgId, name = o.OrgName }),
        ["org analytics"] = new(Level.AdminOrOwner, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/analytics?{Range}", (_, _) => null),
        ["join codes"] = new(Level.AdminOrOwner, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/join-codes", (_, _) => null),
        ["selectable members"] = new(Level.AdminOrOwner, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/members/selectable", (_, _) => null),
        ["another member's analytics"] = new(Level.AdminOrOwner, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/analytics/members/{o.Owner.Id}?{Range}", (_, _) => null),

        // Owner only
        ["delete organization"] = new(Level.Owner, HttpMethod.Delete, (o, _) => $"/api/organizations/{o.OrgId}", (_, _) => null),
        ["regenerate codes"] = new(Level.Owner, HttpMethod.Post, (o, _) => $"/api/organizations/{o.OrgId}/regenerate-codes",
            (o, _) => new { organizationId = o.OrgId, expiryDays = 7 }),
        ["transfer ownership"] = new(Level.Owner, HttpMethod.Post, (o, _) => $"/api/organizations/{o.OrgId}/transfer-ownership",
            (o, _) => new { organizationId = o.OrgId, newOwnerUserId = o.Admin.Id }),

        // Any active member
        ["organization"] = new(Level.Member, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}", (_, _) => null),
        ["member directory"] = new(Level.Member, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/members", (_, _) => null),
        ["my membership"] = new(Level.Member, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/members/me", (_, _) => null),
        ["issue board"] = new(Level.Member, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/issue-board", (_, _) => null),
        ["issue panels"] = new(Level.Member, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/issue-panels", (_, _) => null),
        ["panel issues"] = new(Level.Member, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/issue-panels/{PanelId}/issues", (_, _) => null),
        ["org tasks"] = new(Level.Member, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/tasks?{Range}", (_, _) => null),
        ["org task"] = new(Level.Member, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/tasks/{TaskId}", (_, _) => null),
        ["activity"] = new(Level.Member, HttpMethod.Get, (o, _) => $"/api/organizations/{o.OrgId}/activity", (_, _) => null),
        ["own member analytics"] = new(Level.Member, HttpMethod.Get, (o, u) => $"/api/organizations/{o.OrgId}/analytics/members/{u.Id}?{Range}", (_, _) => null),
        ["my settings"] = new(Level.Member, HttpMethod.Put, (o, _) => $"/api/organizations/{o.OrgId}/members/me/settings",
            (o, _) => new { organizationId = o.OrgId, statusMessage = "Heads down" }),
        ["edit org task"] = new(Level.Member, HttpMethod.Put, (o, _) => $"/api/organizations/{o.OrgId}/tasks/{TaskId}",
            (o, u) => new { organizationId = o.OrgId, taskId = TaskId, title = "Task", start = Start, duration = 1, categoryId = u.CategoryId }),
        ["delete org task"] = new(Level.Member, HttpMethod.Delete, (o, _) => $"/api/organizations/{o.OrgId}/tasks/{TaskId}", (_, _) => null),
    };

    public static TheoryData<string> AllEndpoints => new(Endpoints.Keys);
    public static TheoryData<string> RoleRestricted => new(Endpoints.Where(e => e.Value.Level != Level.Member).Select(e => e.Key));
    public static TheoryData<string> OwnerOnly => new(Endpoints.Where(e => e.Value.Level == Level.Owner).Select(e => e.Key));
    // GETs of one resource by a placeholder id are 404 for members too ("not found"), so they're not in this list.
    private static readonly HashSet<string> NeedsAnExistingResource = new() { "org task" };

    public static TheoryData<string> MemberReadable =>
        new(Endpoints.Where(e => e.Value.Level == Level.Member && e.Value.Method == HttpMethod.Get && !NeedsAnExistingResource.Contains(e.Key))
            .Select(e => e.Key));

    private static readonly SemaphoreSlim SetupGate = new(1, 1);
    private static OrgSetup? _setup;

    private readonly ApiFixture _fixture;

    public OrganizationPermissionTests(ApiFixture fixture) => _fixture = fixture;

    // One organization for the whole matrix: the rejected calls below never change anything.
    private async Task<OrgSetup> SetupAsync()
    {
        await SetupGate.WaitAsync();
        try
        {
            return _setup ??= await OrgTestKit.CreateAsync(_fixture);
        }
        finally
        {
            SetupGate.Release();
        }
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, string name, OrgSetup org, TestUser caller)
    {
        var endpoint = Endpoints[name];
        var request = new HttpRequestMessage(endpoint.Method, endpoint.Url(org, caller));
        var body = endpoint.Body(org, caller);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return client.SendAsync(request);
    }

    [Theory]
    [MemberData(nameof(AllEndpoints))]
    public async Task Signed_out_callers_get_401(string endpoint)
    {
        var org = await SetupAsync();
        var anonymous = _fixture.Factory.CreateClient();

        var response = await SendAsync(anonymous, endpoint, org, org.Member);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(AllEndpoints))]
    public async Task Non_members_get_404_without_learning_that_the_organization_exists(string endpoint)
    {
        var org = await SetupAsync();

        var response = await SendAsync(org.Outsider.Client, endpoint, org, org.Outsider);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("Organization not found.", await OrgTestKit.ReadMessageAsync(response));
    }

    [Theory]
    [MemberData(nameof(RoleRestricted))]
    public async Task Members_without_the_role_get_403_with_a_reason(string endpoint)
    {
        var org = await SetupAsync();

        var response = await SendAsync(org.Member.Client, endpoint, org, org.Member);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var message = await OrgTestKit.ReadMessageAsync(response);
        Assert.False(string.IsNullOrWhiteSpace(message));
        Assert.NotEqual("Organization not found.", message);
    }

    [Theory]
    [MemberData(nameof(OwnerOnly))]
    public async Task Admins_get_403_for_owner_only_actions(string endpoint)
    {
        var org = await SetupAsync();

        var response = await SendAsync(org.Admin.Client, endpoint, org, org.Admin);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(MemberReadable))]
    public async Task Active_members_can_read_member_level_resources(string endpoint)
    {
        var org = await SetupAsync();

        var response = await SendAsync(org.Member.Client, endpoint, org, org.Member);

        Assert.True(response.StatusCode == HttpStatusCode.OK, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
    }

    [Fact]
    public async Task Members_who_left_lose_access_including_the_activity_feed()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        Assert.Equal(HttpStatusCode.OK, (await org.Member.Client.GetAsync($"/api/organizations/{org.OrgId}/activity")).StatusCode);

        var leave = await org.Member.Client.PostAsync($"/api/organizations/{org.OrgId}/members/me/leave", null);
        Assert.Equal(HttpStatusCode.NoContent, leave.StatusCode);

        var activity = await org.Member.Client.GetAsync($"/api/organizations/{org.OrgId}/activity");
        Assert.Equal(HttpStatusCode.NotFound, activity.StatusCode);
        Assert.Equal("Organization not found.", await OrgTestKit.ReadMessageAsync(activity));
    }
}
