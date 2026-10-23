using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TimePlanner.API.Data;
using TimePlanner.API.Utilities;
using Xunit.Abstractions;

namespace TimePlanner.API.Tests.Integration;

/// <summary>
/// "My planner" = personal tasks + organization tasks assigned to me in organizations I'm still in.
/// Capabilities tell the client what the viewer may do, and the organization endpoints enforce the same rules.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class PlannerScopeTests
{
    private const string Day = "startDate=2026-11-02T00:00:00.000Z&endDate=2026-11-03T00:00:00.000Z";

    private readonly ApiFixture _fixture;
    private readonly ITestOutputHelper _output;

    public PlannerScopeTests(ApiFixture fixture, ITestOutputHelper output)
    {
        _fixture = fixture;
        _output = output;
    }

    private static async Task<Dictionary<string, JsonElement>> PlannerAsync(TestUser user, string range = Day)
    {
        var tasks = await OrgTestKit.ReadJsonAsync(await user.Client.GetAsync($"/api/tasks?{range}"), HttpStatusCode.OK);
        return tasks.EnumerateArray().ToDictionary(t => t.GetProperty("title").GetString()!, t => t);
    }

    private static async Task<Guid> CreatePersonalTaskAsync(TestUser user, string title, string start, double duration)
    {
        var response = await user.Client.PostAsJsonAsync("/api/tasks", new { title, start, duration, categoryId = user.CategoryId });
        return (await OrgTestKit.ReadJsonAsync(response, HttpStatusCode.Created)).GetProperty("id").GetGuid();
    }

    private static (bool Edit, bool Delete, bool Reassign) Capabilities(JsonElement task)
    {
        var c = task.GetProperty("capabilities");
        return (c.GetProperty("canEdit").GetBoolean(), c.GetProperty("canDelete").GetBoolean(), c.GetProperty("canReassign").GetBoolean());
    }

    [Fact]
    public async Task Planner_contains_personal_tasks_and_org_tasks_assigned_to_me_only()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        await CreatePersonalTaskAsync(org.Member, "Gym", "2026-11-02T07:00:00.000Z", 1);
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Assigned to member", "2026-11-02T09:00:00.000Z", 1, org.Member);
        await OrgTestKit.CreateOrgTaskAsync(org.Admin, org.OrgId, "Admin made it for the owner", "2026-11-02T10:00:00.000Z", 1, org.Owner);
        await OrgTestKit.CreateSelfOrgTaskAsync(org.Member, org.OrgId, "Member's own org task", "2026-11-02T11:00:00.000Z", 1);

        // A second organization the member leaves: its assigned tasks drop out of the planner.
        var other = await OrgTestKit.CreateAsync(_fixture);
        await OrgTestKit.CreateOrgTaskAsync(other.Owner, other.OrgId, "From an org I left", "2026-11-02T12:00:00.000Z", 1, other.Member);
        await OrgTestKit.CreateOrgTaskAsync(other.Owner, other.OrgId, "Next year in an org I left", "2027-03-01T12:00:00.000Z", 1, other.Member);
        var leaver = other.Member;
        Assert.Single(await PlannerAsync(leaver));
        var yearsBefore = await OrgTestKit.ReadJsonAsync(await leaver.Client.GetAsync("/api/tasks/years"), HttpStatusCode.OK);
        Assert.Contains(yearsBefore.EnumerateArray(), y => y.GetInt32() == 2027);

        Assert.Equal(HttpStatusCode.NoContent, (await leaver.Client.PostAsync($"/api/organizations/{other.OrgId}/members/me/leave", null)).StatusCode);
        Assert.Empty(await PlannerAsync(leaver));
        var yearsAfter = await OrgTestKit.ReadJsonAsync(await leaver.Client.GetAsync("/api/tasks/years"), HttpStatusCode.OK);
        Assert.DoesNotContain(yearsAfter.EnumerateArray(), y => y.GetInt32() == 2027);

        var member = await PlannerAsync(org.Member);
        Assert.Equal(new[] { "Assigned to member", "Gym", "Member's own org task" }, member.Keys.OrderBy(k => k, StringComparer.Ordinal));

        var gym = member["Gym"];
        Assert.Equal(JsonValueKind.Null, gym.GetProperty("organizationId").ValueKind);
        Assert.Equal(JsonValueKind.Null, gym.GetProperty("organizationName").ValueKind);
        Assert.Empty(gym.GetProperty("assignees").EnumerateArray());
        Assert.Equal(org.Member.Id, gym.GetProperty("createdBy").GetProperty("userId").GetGuid());
        Assert.Equal(org.Member.Email, gym.GetProperty("createdBy").GetProperty("displayName").GetString());
        Assert.Equal((true, true, false), Capabilities(gym));

        var assigned = member["Assigned to member"];
        Assert.Equal(org.OrgId, assigned.GetProperty("organizationId").GetGuid());
        Assert.Equal(org.OrgName, assigned.GetProperty("organizationName").GetString());
        var assignee = Assert.Single(assigned.GetProperty("assignees").EnumerateArray());
        Assert.Equal(org.Member.Id, assignee.GetProperty("userId").GetGuid());
        Assert.Equal(org.Member.Email, assignee.GetProperty("email").GetString());
        Assert.Equal(org.Member.Email, assignee.GetProperty("displayName").GetString());
        Assert.Equal(org.Owner.Id, assigned.GetProperty("createdBy").GetProperty("userId").GetGuid());
        Assert.Equal((false, false, false), Capabilities(assigned)); // read-only for an assignee

        Assert.Equal((true, true, false), Capabilities(member["Member's own org task"]));

        // The admin created a task for the owner: it is in the owner's planner, not the admin's.
        Assert.DoesNotContain("Admin made it for the owner", (await PlannerAsync(org.Admin)).Keys);
        var owner = await PlannerAsync(org.Owner);
        Assert.Equal((true, true, true), Capabilities(owner["Admin made it for the owner"]));
    }

    [Fact]
    public async Task Members_can_change_only_org_tasks_they_created()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var assignedId = await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Assigned", "2026-11-03T09:00:00.000Z", 1, org.Member);
        var ownId = await OrgTestKit.CreateSelfOrgTaskAsync(org.Member, org.OrgId, "Own", "2026-11-03T11:00:00.000Z", 1);

        object Edit(Guid taskId, string title, Guid categoryId) => new
        {
            organizationId = org.OrgId, taskId, title, start = "2026-11-03T09:00:00.000Z", duration = 1.5, categoryId
        };

        var editAssigned = await org.Member.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/tasks/{assignedId}", Edit(assignedId, "Moved", org.Member.CategoryId));
        Assert.Equal(HttpStatusCode.Forbidden, editAssigned.StatusCode);
        Assert.Equal("Only an organization admin or the task's creator can edit this task.", await OrgTestKit.ReadMessageAsync(editAssigned));

        var deleteAssigned = await org.Member.Client.DeleteAsync($"/api/organizations/{org.OrgId}/tasks/{assignedId}");
        Assert.Equal(HttpStatusCode.Forbidden, deleteAssigned.StatusCode);
        Assert.Equal("Only an organization admin or the task's creator can delete this task.", await OrgTestKit.ReadMessageAsync(deleteAssigned));

        var editOwn = await org.Member.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/tasks/{ownId}",
            new { organizationId = org.OrgId, taskId = ownId, title = "Own (renamed)", start = "2026-11-03T12:00:00.000Z", duration = 1, categoryId = org.Member.CategoryId });
        Assert.Equal(HttpStatusCode.NoContent, editOwn.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await org.Member.Client.DeleteAsync($"/api/organizations/{org.OrgId}/tasks/{ownId}")).StatusCode);

        // An admin may keep the creator's category (it isn't the admin's)...
        Assert.Equal(HttpStatusCode.NoContent,
            (await org.Admin.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/tasks/{assignedId}", Edit(assignedId, "Renamed by admin", org.Owner.CategoryId))).StatusCode);
        // ...or switch to one of their own, but not to somebody else's.
        Assert.Equal(HttpStatusCode.NoContent,
            (await org.Admin.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/tasks/{assignedId}", Edit(assignedId, "Renamed by admin", org.Admin.CategoryId))).StatusCode);
        var foreign = await org.Admin.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/tasks/{assignedId}", Edit(assignedId, "Renamed by admin", org.Member.CategoryId));
        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);
        Assert.Equal("The specified category was not found for your user.", await OrgTestKit.ReadMessageAsync(foreign));
    }

    [Fact]
    public async Task Personal_endpoints_never_change_org_tasks()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var taskId = await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Org work", "2026-11-04T09:00:00.000Z", 1, org.Member);

        var update = await org.Owner.Client.PutAsJsonAsync($"/api/tasks/{taskId}",
            new { title = "Hijacked", start = "2026-11-04T09:00:00.000Z", duration = 1, categoryId = org.Owner.CategoryId });
        Assert.Equal(HttpStatusCode.NotFound, update.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await org.Owner.Client.DeleteAsync($"/api/tasks/{taskId}")).StatusCode);

        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var task = await db.Tasks.AsNoTracking().SingleAsync(t => t.Id == taskId);
        Assert.Equal("Org work", task.Title);
        Assert.False(task.IsDeleted);
    }

    [Fact]
    public async Task Personal_tasks_cannot_overlap_org_tasks_assigned_to_me()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var orgMessage = $"This time overlaps a task assigned to you in {org.OrgName}.";
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Standup", "2026-11-05T09:00:00.000Z", 1, org.Member);

        var overlapping = await org.Member.Client.PostAsJsonAsync("/api/tasks",
            new { title = "Dentist", start = "2026-11-05T09:30:00.000Z", duration = 1, categoryId = org.Member.CategoryId });
        Assert.Equal(HttpStatusCode.Conflict, overlapping.StatusCode);
        Assert.Equal(orgMessage, await OrgTestKit.ReadMessageAsync(overlapping));

        var touchingId = await CreatePersonalTaskAsync(org.Member, "Coffee", "2026-11-05T08:00:00.000Z", 1);

        var move = await org.Member.Client.PutAsJsonAsync($"/api/tasks/{touchingId}",
            new { title = "Coffee", start = "2026-11-05T08:30:00.000Z", duration = 1, categoryId = org.Member.CategoryId });
        Assert.Equal(HttpStatusCode.Conflict, move.StatusCode);
        Assert.Equal(orgMessage, await OrgTestKit.ReadMessageAsync(move));

        var template = await OrgTestKit.ReadJsonAsync(
            await org.Member.Client.PostAsJsonAsync("/api/tasktemplates", new { title = "Focus", duration = 1, categoryId = org.Member.CategoryId }),
            HttpStatusCode.Created);
        var fromTemplate = await org.Member.Client.PostAsJsonAsync("/api/tasks/from-template",
            new { templateId = template.GetProperty("id").GetGuid(), start = "2026-11-05T09:15:00.000Z" });
        Assert.Equal(HttpStatusCode.Conflict, fromTemplate.StatusCode);
        Assert.Equal(orgMessage, await OrgTestKit.ReadMessageAsync(fromTemplate));

        // Personal vs personal keeps its old message.
        var personal = await org.Member.Client.PostAsJsonAsync("/api/tasks",
            new { title = "Espresso", start = "2026-11-05T08:30:00.000Z", duration = 0.25, categoryId = org.Member.CategoryId });
        Assert.Equal(HttpStatusCode.Conflict, personal.StatusCode);
        Assert.Equal("This time slot overlaps with an existing task.", await OrgTestKit.ReadMessageAsync(personal));

        // Org tasks are not checked against the assignee's personal calendar.
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Review", "2026-11-05T08:00:00.000Z", 0.5, org.Member);

        // An org task created by the member for someone else is not in their planner and doesn't block them.
        var colleague = await OrgTestKit.CreateAsync(_fixture);
        await OrgTestKit.CreateOrgTaskAsync(colleague.Owner, colleague.OrgId, "For the admin", "2026-11-05T14:00:00.000Z", 1, colleague.Admin);
        await CreatePersonalTaskAsync(colleague.Owner, "Lunch", "2026-11-05T14:00:00.000Z", 1);
    }

    [Fact]
    public async Task Personal_analytics_count_assigned_org_tasks_under_the_organization()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        await CreatePersonalTaskAsync(org.Member, "Write", "2026-11-06T07:00:00.000Z", 1);
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Planning", "2026-11-06T09:00:00.000Z", 2, org.Member);

        var analytics = await OrgTestKit.ReadJsonAsync(
            await org.Member.Client.GetAsync("/api/tasks/analytics?startDate=2026-11-02T00:00:00.000Z&endDate=2026-11-09T00:00:00.000Z&viewType=daily"),
            HttpStatusCode.OK);

        Assert.Equal(3, analytics.GetProperty("totalHours").GetDouble());
        var categories = analytics.GetProperty("timePerCategory").EnumerateArray()
            .ToDictionary(c => c.GetProperty("categoryId").GetGuid());
        Assert.Equal(2, categories.Count);
        Assert.Equal(1, categories[org.Member.CategoryId].GetProperty("totalHours").GetDouble());

        var orgBucket = categories[org.OrgId];
        Assert.Equal(org.OrgName, orgBucket.GetProperty("categoryName").GetString());
        Assert.Equal(OrganizationPalette.ColorFor(org.OrgId), orgBucket.GetProperty("categoryColor").GetString());
        Assert.Equal(2, orgBucket.GetProperty("totalHours").GetDouble());
        Assert.DoesNotContain(org.Owner.CategoryId, categories.Keys); // the creator's personal category

        var day = Assert.Single(analytics.GetProperty("breakdownData").EnumerateArray());
        Assert.Equal(OrganizationPalette.ColorFor(org.OrgId), day.GetProperty("dominantCategoryColor").GetString());
        Assert.Empty(analytics.GetProperty("timePerTemplate").EnumerateArray());
    }

    [Fact]
    public async Task Org_task_updates_use_a_fixed_number_of_queries_regardless_of_assignees()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        var single = await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "One assignee", "2026-11-07T08:00:00.000Z", 1, org.Member);
        var triple = await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Three assignees", "2026-11-07T10:00:00.000Z", 1, org.Owner, org.Admin, org.Member);

        async Task<int> CountUpdateAsync(Guid taskId, string title)
        {
            using (_fixture.SqlCommands.Start())
            {
                var response = await org.Owner.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/tasks/{taskId}",
                    new { organizationId = org.OrgId, taskId, title, start = "2026-11-07T12:00:00.000Z", duration = 1, categoryId = org.Owner.CategoryId });
                Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
            }

            return _fixture.SqlCommands.Count;
        }

        async Task<int> CountReassignAsync(Guid taskId, params Guid[] assignees)
        {
            using (_fixture.SqlCommands.Start())
            {
                var response = await org.Owner.Client.PutAsJsonAsync($"/api/organizations/{org.OrgId}/tasks/{taskId}/assignees",
                    new { organizationId = org.OrgId, taskId, newAssigneeIds = assignees });
                Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
            }

            return _fixture.SqlCommands.Count;
        }

        var updateOne = await CountUpdateAsync(single, "One (renamed)");
        var updateThree = await CountUpdateAsync(triple, "Three (renamed)");
        Assert.Equal(updateOne, updateThree);
        Assert.InRange(updateOne, 1, 5); // membership, task, save, DTO projection

        var reassignOne = await CountReassignAsync(single, org.Member.Id, org.Admin.Id);
        var reassignThree = await CountReassignAsync(triple, org.Owner.Id, org.Admin.Id, org.Member.Id, org.Member.Id);
        _output.WriteLine($"SQL commands - update: {updateOne} (1 assignee) / {updateThree} (3 assignees); reassign: {reassignOne} / {reassignThree}");
        Assert.InRange(reassignOne, 1, 6);
        Assert.InRange(reassignThree, 1, 6);
    }
}
