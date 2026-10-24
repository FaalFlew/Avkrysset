using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TimePlanner.API.Data;

namespace TimePlanner.API.Tests.Integration;

/// <summary>Business-rule violations return 400/409 with their message (they used to be 500), plus validators.</summary>
[Collection(ApiCollection.Name)]
public sealed class OrganizationRulesTests
{
    private readonly ApiFixture _fixture;

    public OrganizationRulesTests(ApiFixture fixture) => _fixture = fixture;

    private static async Task AssertStatusAsync(HttpResponseMessage response, HttpStatusCode expected, string message)
    {
        var content = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expected, $"Expected {(int)expected}, got {(int)response.StatusCode}: {content}");
        Assert.Equal(message, await OrgTestKit.ReadMessageAsync(response));
    }

    [Fact]
    public async Task Owner_cannot_leave_or_be_removed_409()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);

        await AssertStatusAsync(
            await org.Owner.Client.PostAsync($"/api/organizations/{org.OrgId}/members/me/leave", null),
            HttpStatusCode.Conflict, "The organization owner cannot leave. Transfer ownership to another member before leaving.");

        await AssertStatusAsync(
            await org.Admin.Client.DeleteAsync($"/api/organizations/{org.OrgId}/members/{org.Owner.Id}"),
            HttpStatusCode.Conflict, "The organization owner cannot be removed. Transfer ownership first.");
    }

    [Fact]
    public async Task Ownership_transfer_rules_return_400()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var url = $"/api/organizations/{org.OrgId}/transfer-ownership";

        await AssertStatusAsync(
            await org.Owner.Client.PostAsJsonAsync(url, new { organizationId = org.OrgId, newOwnerUserId = org.Owner.Id }),
            HttpStatusCode.BadRequest, "You cannot transfer ownership to yourself.");

        await AssertStatusAsync(
            await org.Owner.Client.PostAsJsonAsync(url, new { organizationId = org.OrgId, newOwnerUserId = org.Member.Id }),
            HttpStatusCode.BadRequest, "Ownership can only be transferred to an active Admin of the organization.");
    }

    [Fact]
    public async Task Controller_level_400s_use_the_json_error_shape()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);

        // Route/body mismatch (used to be a plain-text body).
        await AssertStatusAsync(
            await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/transfer-ownership",
                new { organizationId = Guid.NewGuid(), newOwnerUserId = org.Admin.Id }),
            HttpStatusCode.BadRequest, "Route parameter 'organizationId' must match the command body.");

        // Inverted date range on an org query (used to be a plain-text body).
        await AssertStatusAsync(
            await org.Owner.Client.GetAsync(
                $"/api/organizations/{org.OrgId}/tasks?startDate=2026-10-02T00:00:00.000Z&endDate=2026-10-01T00:00:00.000Z"),
            HttpStatusCode.BadRequest, "The start date must be before the end date.");
    }

    [Fact]
    public async Task Owner_role_cannot_be_changed_and_admins_cannot_demote_admins()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);

        await AssertStatusAsync(
            await org.Admin.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/members/{org.Owner.Id}/role",
                new { organizationId = org.OrgId, userId = org.Owner.Id, newRole = "Member" }),
            HttpStatusCode.BadRequest, "The organization owner's role cannot be changed here. Use 'Transfer ownership' instead.");

        // Promote the member to a second admin: it can't demote the first admin; only the owner can.
        Assert.Equal(HttpStatusCode.NoContent,
            (await org.Owner.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/members/{org.Member.Id}/role",
                new { organizationId = org.OrgId, userId = org.Member.Id, newRole = "Admin" })).StatusCode);
        await AssertStatusAsync(
            await org.Member.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/members/{org.Admin.Id}/role",
                new { organizationId = org.OrgId, userId = org.Admin.Id, newRole = "Member" }),
            HttpStatusCode.Forbidden, "Only the organization owner can demote an admin.");
    }

    [Fact]
    public async Task Converted_issues_cannot_be_edited_or_deleted_409()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var panel = await OrgTestKit.ReadJsonAsync(
            await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issue-panels", new { organizationId = org.OrgId, name = "Backlog" }),
            HttpStatusCode.Created);
        var panelId = panel.GetProperty("id").GetGuid();
        var issue = await OrgTestKit.ReadJsonAsync(
            await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issue-panels/{panelId}/issues",
                new { organizationId = org.OrgId, panelId, title = "Fix login", notes = (string?)null, categoryId = org.Owner.CategoryId }),
            HttpStatusCode.Created);
        var issueId = issue.GetProperty("id").GetGuid();
        await OrgTestKit.ReadJsonAsync(
            await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/issues/{issueId}/promote-to-task",
                new { organizationId = org.OrgId, issueId, start = "2026-10-21T08:00:00.000Z", duration = 1, assigneeIds = new[] { org.Member.Id } }),
            HttpStatusCode.Created);

        await AssertStatusAsync(
            await org.Owner.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/issue-panels/{panelId}/issues/{issueId}",
                new { organizationId = org.OrgId, panelId, issueId, title = "Changed", notes = (string?)null, categoryId = org.Owner.CategoryId }),
            HttpStatusCode.Conflict, "Cannot edit an issue that has already been converted to a task.");
        await AssertStatusAsync(
            await org.Owner.Client.DeleteAsync($"/api/organizations/{org.OrgId}/issue-panels/{panelId}/issues/{issueId}"),
            HttpStatusCode.Conflict, "Cannot delete an issue that has already been converted to a task. Delete the task instead.");
    }

    [Fact]
    public async Task The_default_Other_category_cannot_be_deleted_400()
    {
        var user = await _fixture.CreateUserAsync();
        var other = await OrgTestKit.ReadJsonAsync(
            await user.Client.PostAsJsonAsync("/api/categories", new { name = "Other", color = "#7D8590" }), HttpStatusCode.Created);

        await AssertStatusAsync(
            await user.Client.DeleteAsync($"/api/categories/{other.GetProperty("id").GetGuid()}"),
            HttpStatusCode.BadRequest, "The default 'Other' category cannot be deleted.");
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(-5, false)]
    [InlineData(366, false)]
    [InlineData(1, true)]
    [InlineData(365, true)]
    public async Task Join_code_expiry_must_be_1_to_365_days(int expiryDays, bool valid)
    {
        var org = await OrgTestKit.CreateAsync(_fixture);

        var response = await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/regenerate-codes",
            new { organizationId = org.OrgId, expiryDays });

        if (valid)
        {
            var body = await OrgTestKit.ReadJsonAsync(response, HttpStatusCode.OK);
            var expiry = body.GetProperty("memberJoinCodeExpiryUtc").GetDateTime();
            Assert.InRange(expiry, DateTime.UtcNow.AddDays(expiryDays).AddMinutes(-5), DateTime.UtcNow.AddDays(expiryDays).AddMinutes(5));
        }
        else
        {
            await AssertStatusAsync(response, HttpStatusCode.BadRequest, "Join codes can be valid for 1 to 365 days.");
        }
    }

    [Fact]
    public async Task Invite_and_role_validation_report_one_message_per_field()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);

        var invite = await org.Owner.Client.PostAsJsonAsync($"/api/organizations/{org.OrgId}/invitations",
            new { organizationId = org.OrgId, email = "", role = "" });
        Assert.Equal(HttpStatusCode.BadRequest, invite.StatusCode);
        Assert.Equal(new[] { "Email is required.", "Role is required." }, await ReadErrorsAsync(invite));

        var role = await org.Owner.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/members/{org.Member.Id}/role",
            new { organizationId = org.OrgId, userId = org.Member.Id, newRole = "" });
        Assert.Equal(HttpStatusCode.BadRequest, role.StatusCode);
        Assert.Equal(new[] { "Role is required." }, await ReadErrorsAsync(role));
    }

    [Fact]
    public async Task Reassigning_a_task_to_nobody_is_rejected()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var taskId = await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Review", "2026-10-22T08:00:00.000Z", 1, org.Member);

        await AssertStatusAsync(
            await org.Owner.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/tasks/{taskId}/assignees",
                new { organizationId = org.OrgId, taskId, newAssigneeIds = Array.Empty<Guid>() }),
            HttpStatusCode.BadRequest, "At least one assignee is required.");
    }

    // --- Organization time zone ---

    [Theory]
    [InlineData("Europe/Oslo", "Europe/Oslo")]
    [InlineData("Asia/Calcutta", "Asia/Calcutta")]
    [InlineData(null, "UTC")]
    [InlineData("Mars/Olympus_Mons", "UTC")]  // unknown header => UTC
    [InlineData("Europe/Oslo; x", "UTC")]     // malformed header => UTC
    public async Task New_organizations_default_to_the_creators_time_zone(string? header, string expected)
    {
        var org = await OrgTestKit.CreateAsync(_fixture, header);

        var body = await OrgTestKit.ReadJsonAsync(await org.Member.Client.GetAsync($"/api/organizations/{org.OrgId}"), HttpStatusCode.OK);
        Assert.Equal(expected, body.GetProperty("timeZoneId").GetString());
    }

    [Fact]
    public async Task An_explicit_time_zone_wins_and_must_be_known()
    {
        var owner = await _fixture.CreateUserAsync();

        using var create = new HttpRequestMessage(HttpMethod.Post, "/api/organizations")
        {
            Content = JsonContent.Create(new { name = $"Org {Guid.NewGuid():N}", timeZoneId = "Asia/Kolkata" })
        };
        create.Headers.TryAddWithoutValidation("X-Time-Zone", "Europe/Oslo");
        var created = await OrgTestKit.ReadJsonAsync(await owner.Client.SendAsync(create), HttpStatusCode.Created);
        Assert.Equal("Asia/Kolkata", created.GetProperty("timeZoneId").GetString());

        await AssertStatusAsync(
            await owner.Client.PostAsJsonAsync("/api/organizations", new { name = $"Org {Guid.NewGuid():N}", timeZoneId = "Nowhere/Zone" }),
            HttpStatusCode.BadRequest, "Unknown time zone. Use an IANA time zone such as Europe/Oslo.");
    }

    [Fact]
    public async Task Admins_can_change_the_time_zone_and_omitting_it_keeps_it()
    {
        var org = await OrgTestKit.CreateAsync(_fixture, "Europe/Oslo");
        var url = $"/api/organizations/{org.OrgId}";

        Assert.Equal(HttpStatusCode.NoContent,
            (await org.Admin.Client.PutAsJsonAsync(url, new { organizationId = org.OrgId, name = org.OrgName, timeZoneId = "America/New_York" })).StatusCode);
        Assert.Equal("America/New_York", (await ReadOrgAsync(org)).GetProperty("timeZoneId").GetString());

        Assert.Equal(HttpStatusCode.NoContent,
            (await org.Admin.Client.PutAsJsonAsync(url, new { organizationId = org.OrgId, name = org.OrgName + " 2" })).StatusCode);
        Assert.Equal("America/New_York", (await ReadOrgAsync(org)).GetProperty("timeZoneId").GetString());

        await AssertStatusAsync(
            await org.Admin.Client.PutAsJsonAsync(url, new { organizationId = org.OrgId, name = org.OrgName, timeZoneId = "Nope" }),
            HttpStatusCode.BadRequest, "Unknown time zone. Use an IANA time zone such as Europe/Oslo.");
    }

    // --- Profile ---

    [Fact]
    public async Task Users_can_read_and_set_their_display_name()
    {
        var user = await _fixture.CreateUserAsync();

        var profile = await OrgTestKit.ReadJsonAsync(await user.Client.GetAsync("/api/users/me"), HttpStatusCode.OK);
        Assert.Equal(user.Id, profile.GetProperty("id").GetGuid());
        Assert.Equal(user.Email, profile.GetProperty("email").GetString());
        Assert.Equal(JsonValueKind.Null, profile.GetProperty("displayName").ValueKind);

        var updated = await OrgTestKit.ReadJsonAsync(
            await user.Client.PutAsJsonAsync("/api/users/me", new { displayName = "  Ada Lovelace  " }), HttpStatusCode.OK);
        Assert.Equal("Ada Lovelace", updated.GetProperty("displayName").GetString());
        Assert.Equal("Ada Lovelace",
            (await OrgTestKit.ReadJsonAsync(await user.Client.GetAsync("/api/users/me"), HttpStatusCode.OK)).GetProperty("displayName").GetString());

        var cleared = await OrgTestKit.ReadJsonAsync(
            await user.Client.PutAsJsonAsync("/api/users/me", new { displayName = "   " }), HttpStatusCode.OK);
        Assert.Equal(JsonValueKind.Null, cleared.GetProperty("displayName").ValueKind);

        Assert.Equal(HttpStatusCode.OK,
            (await user.Client.PutAsJsonAsync("/api/users/me", new { displayName = new string('a', 100) })).StatusCode);
        await AssertStatusAsync(
            await user.Client.PutAsJsonAsync("/api/users/me", new { displayName = new string('a', 101) }),
            HttpStatusCode.BadRequest, "Display name can be at most 100 characters.");

        Assert.Equal(HttpStatusCode.Unauthorized, (await _fixture.Factory.CreateClient().GetAsync("/api/users/me")).StatusCode);
    }

    [Fact]
    public async Task Display_names_appear_in_organization_payloads_with_email_fallback()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        await org.Member.Client.PutAsJsonAsync("/api/users/me", new { displayName = "Grace" });

        var members = await OrgTestKit.ReadJsonAsync(await org.Owner.Client.GetAsync($"/api/organizations/{org.OrgId}/members"), HttpStatusCode.OK);
        var byId = members.EnumerateArray().ToDictionary(m => m.GetProperty("userId").GetGuid(), m => m.GetProperty("displayName").GetString());
        Assert.Equal("Grace", byId[org.Member.Id]);
        Assert.Equal(org.Owner.Email, byId[org.Owner.Id]); // no display name => email

        var selectable = await OrgTestKit.ReadJsonAsync(await org.Owner.Client.GetAsync($"/api/organizations/{org.OrgId}/members/selectable"), HttpStatusCode.OK);
        Assert.Contains(selectable.EnumerateArray(), m => m.GetProperty("displayName").GetString() == "Grace");

        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Pair up", "2026-10-23T08:00:00.000Z", 2, org.Member);
        var analytics = await OrgTestKit.ReadJsonAsync(
            await org.Owner.Client.GetAsync($"/api/organizations/{org.OrgId}/analytics?view=weekly&year=2026&from=43&to=43"),
            HttpStatusCode.OK);
        Assert.Contains(analytics.GetProperty("timePerMember").EnumerateArray(), m => m.GetProperty("displayName").GetString() == "Grace");

        var activity = await OrgTestKit.ReadJsonAsync(await org.Owner.Client.GetAsync($"/api/organizations/{org.OrgId}/activity"), HttpStatusCode.OK);
        Assert.Contains(activity.EnumerateArray(), a => a.GetProperty("actorDisplayName").GetString() == "Grace");
    }

    // --- Migration ---

    [Fact]
    public async Task The_new_migration_applied_cleanly_to_the_fresh_test_database()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        Assert.Contains(await db.Database.GetAppliedMigrationsAsync(), m => m.EndsWith("_AddOrgTimeZoneAndDisplayName", StringComparison.Ordinal));
        Assert.False(db.Database.HasPendingModelChanges());

        var columns = await db.Database
            .SqlQuery<string>($"SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME, ':', DATA_TYPE, '(', CHARACTER_MAXIMUM_LENGTH, ')', IS_NULLABLE) AS [Value] FROM INFORMATION_SCHEMA.COLUMNS WHERE (TABLE_NAME = 'Organizations' AND COLUMN_NAME = 'TimeZoneId') OR (TABLE_NAME = 'AspNetUsers' AND COLUMN_NAME = 'DisplayName')")
            .ToListAsync();
        Assert.Contains("Organizations.TimeZoneId:nvarchar(64)NO", columns);
        Assert.Contains("AspNetUsers.DisplayName:nvarchar(100)YES", columns);

        var indexes = await db.Database
            .SqlQuery<string>($"SELECT name AS [Value] FROM sys.indexes WHERE object_id = OBJECT_ID('Tasks')")
            .ToListAsync();
        Assert.Contains("IX_Tasks_UserId_Start", indexes);
        Assert.Contains("IX_Tasks_OrganizationId_Start", indexes);
    }

    private static async Task<JsonElement> ReadOrgAsync(OrgSetup org) =>
        await OrgTestKit.ReadJsonAsync(await org.Owner.Client.GetAsync($"/api/organizations/{org.OrgId}"), HttpStatusCode.OK);

    private static async Task<string[]> ReadErrorsAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToArray();
    }
}
