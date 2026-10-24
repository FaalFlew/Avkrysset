using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TimePlanner.API.Data;
using TimePlanner.API.Models;

namespace TimePlanner.API.Tests.Integration;

/// <summary>The derived activity feed (docs/plans/organizations-phase3.md §2.8): paging, sources and actors.</summary>
[Collection(ApiCollection.Name)]
public sealed class OrganizationActivityApiTests
{
    private readonly ApiFixture _fixture;

    public OrganizationActivityApiTests(ApiFixture fixture) => _fixture = fixture;

    [Theory]
    [InlineData(0, false)]
    [InlineData(101, false)]
    [InlineData(1, true)]
    [InlineData(100, true)]
    public async Task Limit_must_be_1_to_100(int limit, bool valid)
    {
        var org = await OrgTestKit.CreateAsync(_fixture);

        var response = await org.Member.Client.GetAsync($"/api/organizations/{org.OrgId}/activity?limit={limit}");

        if (valid)
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        else
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("limit must be between 1 and 100.", await OrgTestKit.ReadMessageAsync(response));
        }
    }

    [Fact]
    public async Task Paging_with_before_returns_every_item_exactly_once_in_order()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        for (var i = 0; i < 4; i++)
        {
            var taskId = await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, $"Task {i}", $"2026-11-0{i + 2}T09:00:00.000Z", 1, org.Member);
            if (i % 2 == 0)
            {
                await UpdateTaskAsync(org.Admin, org.OrgId, taskId, $"Task {i} (moved)");
            }
        }

        var panelId = (await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issue-panels",
            new { organizationId = org.OrgId, name = "Backlog" }), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        await OrgTestKit.ReadJsonAsync(await org.Admin.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issue-panels/{panelId}/issues",
            new { organizationId = org.OrgId, panelId, title = "Bug", notes = (string?)null, categoryId = org.Admin.CategoryId }), HttpStatusCode.Created);
        Assert.Equal(HttpStatusCode.NoContent, (await org.Member.Client.PostAsync($"/api/organizations/{org.OrgId}/members/me/leave", null)).StatusCode);

        var all = await PageAsync(org.Owner, org.OrgId, "limit=100");
        Assert.Equal(JsonValueKind.Null, all.GetProperty("nextBefore").ValueKind);
        var expected = Ids(all);
        // org created + 3 joins + 4 tasks created + 2 updates + 1 issue + 1 left (the member's join stays)
        Assert.Equal(12, expected.Length);
        var timestamps = all.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("timestamp").GetString()!).ToList();
        Assert.Equal(timestamps.OrderByDescending(t => t, StringComparer.Ordinal), timestamps);

        foreach (var limit in new[] { 1, 2, 5 })
        {
            var seen = new List<string>();
            string? before = null;
            for (var guard = 0; guard < 50; guard++)
            {
                var page = await PageAsync(org.Owner, org.OrgId, $"limit={limit}" + (before is null ? "" : $"&before={Uri.EscapeDataString(before)}"));
                seen.AddRange(Ids(page));
                var next = page.GetProperty("nextBefore");
                if (next.ValueKind == JsonValueKind.Null)
                {
                    break;
                }

                before = next.GetString();
                Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", before);
            }

            Assert.Equal(expected, seen);
        }
    }

    [Fact]
    public async Task Items_in_the_same_millisecond_are_never_split_across_pages_or_lost()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var panelId = (await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issue-panels",
            new { organizationId = org.OrgId, name = "Backlog" }), HttpStatusCode.Created)).GetProperty("id").GetGuid();
        var issueIds = new List<Guid>();
        for (var i = 0; i < 3; i++)
        {
            issueIds.Add((await OrgTestKit.ReadJsonAsync(await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issue-panels/{panelId}/issues",
                new { organizationId = org.OrgId, panelId, title = $"Issue {i}", notes = (string?)null, categoryId = org.Owner.CategoryId }),
                HttpStatusCode.Created)).GetProperty("id").GetGuid());
        }

        // Three issues inside one millisecond (sub-millisecond apart), older than the joins.
        var tie = new DateTime(2026, 10, 1, 12, 0, 0, 123, DateTimeKind.Utc);
        using (var scope = _fixture.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            for (var i = 0; i < issueIds.Count; i++)
            {
                var id = issueIds[i];
                var at = tie.AddTicks(1000 * (i + 1));
                await db.Issues.Where(x => x.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.CreatedOnUtc, at));
            }
        }

        var expected = Ids(await PageAsync(org.Owner, org.OrgId, "limit=100"));
        Assert.Equal(7, expected.Length); // created + 3 joins + 3 issues
        foreach (var limit in new[] { 1, 2, 3, 4 })
        {
            var seen = new List<string>();
            string? before = null;
            for (var guard = 0; guard < 20; guard++)
            {
                var page = await PageAsync(org.Owner, org.OrgId, $"limit={limit}" + (before is null ? "" : $"&before={Uri.EscapeDataString(before)}"));
                var ids = Ids(page);
                // A page is only larger than the limit when one millisecond alone holds more than `limit` items.
                Assert.True(ids.Length <= Math.Max(limit, 3), $"limit {limit}: page of {ids.Length}");
                seen.AddRange(ids);
                if (page.GetProperty("nextBefore").ValueKind == JsonValueKind.Null)
                {
                    break;
                }

                before = page.GetProperty("nextBefore").GetString();
            }

            Assert.Equal(expected, seen);
        }
    }

    [Fact]
    public async Task Updates_are_attributed_to_whoever_made_them()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        await org.Admin.Client.PutAsJsonAsync("/api/users/me", new { displayName = "Ada" });
        var taskId = await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Deploy", "2026-11-03T09:00:00.000Z", 1, org.Member);
        await UpdateTaskAsync(org.Admin, org.OrgId, taskId, "Deploy v2");

        var items = Items(await PageAsync(org.Member, org.OrgId, "limit=50"));

        var updated = items[$"task:{taskId}:updated"];
        Assert.Equal((org.Admin.Id, "Ada", org.Admin.Email), (updated.GetProperty("actorUserId").GetGuid(),
            updated.GetProperty("actorDisplayName").GetString(), updated.GetProperty("actorUserEmail").GetString()));
        Assert.Equal(("Updated", "Task", taskId.ToString()), (updated.GetProperty("actionType").GetString(),
            updated.GetProperty("entityType").GetString(), updated.GetProperty("entityId").GetString()));
        Assert.Equal("Ada updated task 'Deploy v2'.", updated.GetProperty("description").GetString());
        Assert.Equal(org.Owner.Id, items[$"task:{taskId}:created"].GetProperty("actorUserId").GetGuid());
    }

    [Fact]
    public async Task Leaving_and_removal_show_up_with_who_removed_whom()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var removed = await _fixture.CreateUserAsync();
        var codes = await OrgTestKit.ReadJsonAsync(await org.Owner.Client.GetAsync($"/api/organizations/{org.OrgId}/join-codes"), HttpStatusCode.OK);
        await OrgTestKit.JoinAsync(removed, codes.GetProperty("memberJoinCode").GetString()!);
        Assert.Equal(HttpStatusCode.NoContent, (await org.Member.Client.PostAsync($"/api/organizations/{org.OrgId}/members/me/leave", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await org.Admin.Client.DeleteAsync($"/api/organizations/{org.OrgId}/members/{removed.Id}")).StatusCode);

        var items = Items(await PageAsync(org.Owner, org.OrgId, "limit=50")).Values.ToList();

        var left = Assert.Single(items, i => i.GetProperty("actionType").GetString() == "Left");
        Assert.Equal((org.Member.Id, org.Member.Id.ToString()), (left.GetProperty("actorUserId").GetGuid(), left.GetProperty("entityId").GetString()));
        var removal = Assert.Single(items, i => i.GetProperty("actionType").GetString() == "Removed");
        Assert.Equal((org.Admin.Id, removed.Id.ToString()), (removal.GetProperty("actorUserId").GetGuid(), removal.GetProperty("entityId").GetString()));
        Assert.Equal($"{org.Admin.Email} removed {removed.Email} from the organization.", removal.GetProperty("description").GetString());
        Assert.Equal(4, items.Count(i => i.GetProperty("actionType").GetString() == "Joined"));
        Assert.Single(items, i => i.GetProperty("entityType").GetString() == "Organization");
    }

    [Fact]
    public async Task Organization_report_exports_are_in_the_feed()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var documentId = $"TP-20261105-{Guid.NewGuid():N}"[..20];
        await AddExportAsync(org.OrgId, documentId, requestedBy: org.Admin.Id, subject: null, kind: "Organization");

        var export = Assert.Single(Items(await PageAsync(org.Owner, org.OrgId, "limit=50")).Values,
            i => i.GetProperty("actionType").GetString() == "Exported");

        Assert.Equal(("Report", documentId, org.Admin.Id), (export.GetProperty("entityType").GetString(),
            export.GetProperty("entityId").GetString(), export.GetProperty("actorUserId").GetGuid()));
    }

    // --- Helpers ---

    private async Task AddExportAsync(Guid orgId, string documentId, Guid requestedBy, Guid? subject, string kind)
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        db.ReportExports.Add(new ReportExport
        {
            DocumentId = documentId, Kind = kind, Format = "pdf", RequestedByUserId = requestedBy, OrganizationId = orgId,
            SubjectUserId = subject, RangeStartUtc = DateTime.UtcNow.AddDays(-7), RangeEndUtc = DateTime.UtcNow, ViewType = "weekly",
            TimeZoneId = "UTC", Culture = "invariant", ContentSha256 = new byte[32], CreatedOnUtc = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private static async Task UpdateTaskAsync(TestUser editor, Guid orgId, Guid taskId, string title)
    {
        var task = await OrgTestKit.ReadJsonAsync(await editor.Client.GetAsync($"/api/organizations/{orgId}/tasks/{taskId}"), HttpStatusCode.OK);
        var response = await editor.Client.PutAsJsonAsync($"/api/organizations/{orgId}/tasks/{taskId}", new
        {
            organizationId = orgId, taskId, title, start = task.GetProperty("start").GetString(),
            duration = task.GetProperty("duration").GetDouble(), categoryId = task.GetProperty("categoryId").GetGuid()
        });
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    private static async Task<JsonElement> PageAsync(TestUser user, Guid orgId, string query) =>
        await OrgTestKit.ReadJsonAsync(await user.Client.GetAsync($"/api/organizations/{orgId}/activity?{query}"), HttpStatusCode.OK);

    private static string[] Ids(JsonElement page) =>
        page.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("id").GetString()!).ToArray();

    private static Dictionary<string, JsonElement> Items(JsonElement page) =>
        page.GetProperty("items").EnumerateArray().ToDictionary(i => i.GetProperty("id").GetString()!);
}
