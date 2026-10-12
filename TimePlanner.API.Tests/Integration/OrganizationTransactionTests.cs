using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TimePlanner.API.Data;
using TimePlanner.API.Models;
using TimePlanner.API.Models.Organization;

namespace TimePlanner.API.Tests.Integration;

/// <summary>
/// The handlers that open their own transaction used to fail with 500 on every call, because the
/// retrying execution strategy (EnableRetryOnFailure) rejects user-initiated transactions.
/// Each one must now succeed, roll back completely when something fails inside the transaction,
/// and send its notifications only once and only after the commit.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class OrganizationTransactionTests
{
    private readonly ApiFixture _fixture;

    public OrganizationTransactionTests(ApiFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Create_organization_succeeds_and_makes_the_creator_owner()
    {
        var owner = await _fixture.CreateUserAsync();

        var org = await CreateOrganizationAsync(owner);

        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var membership = await db.OrganizationMemberships.AsNoTracking()
            .SingleAsync(m => m.OrganizationId == org.Id);
        Assert.Equal(owner.Id, membership.UserId);
        Assert.Equal(OrganizationRoles.Owner, membership.Role);
        Assert.Equal(MembershipStatus.Active, membership.Status);
    }

    [Fact]
    public async Task Create_organization_failure_after_the_insert_rolls_back_the_organization()
    {
        var owner = await _fixture.CreateUserAsync();
        var name = $"Doomed {Guid.NewGuid():N}";

        // Fails the second SaveChanges (owner membership), after the organization row was written.
        using (_fixture.Faults.Arm(
                   ctx => ctx.ChangeTracker.Entries<OrganizationMembership>().Any(e => e.State == EntityState.Added)
                          && ctx.ChangeTracker.Entries<Organization>().Any(e => e.Entity.Name == name),
                   () => new InvalidOperationException("Forced failure inside the transaction.")))
        {
            var response = await owner.Client.PostAsJsonAsync("/api/organizations", new { name });
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            Assert.Equal(1, _fixture.Faults.Triggered);
        }

        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        Assert.False(await db.Organizations.IgnoreQueryFilters().AnyAsync(o => o.Name == name));
    }

    [Fact]
    public async Task Organization_task_is_created_with_assignments_and_notified_once()
    {
        var (owner, admin, org) = await CreateOrganizationWithAdminAsync();
        var title = $"Org task {Guid.NewGuid():N}";
        var before = _fixture.Notifications.EventsFor(org.Id).Length;

        var response = await PostOrganizationTaskAsync(owner, org.Id, title, owner.Id, admin.Id);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var (tasks, assignments) = await CountTaskAsync(title);
        Assert.Equal(1, tasks);
        Assert.Equal(2, assignments);
        Assert.Equal(new[] { "TaskCreated" }, NewEvents(org.Id, before));
    }

    [Fact]
    public async Task Organization_task_failure_after_the_task_insert_rolls_back_and_sends_nothing()
    {
        var (owner, admin, org) = await CreateOrganizationWithAdminAsync();
        var title = $"Org task {Guid.NewGuid():N}";
        var before = _fixture.Notifications.EventsFor(org.Id).Length;

        using (_fixture.Faults.Arm(AssignmentSaveFor(title), () => new InvalidOperationException("Forced failure inside the transaction.")))
        {
            var response = await PostOrganizationTaskAsync(owner, org.Id, title, admin.Id);
            Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
            Assert.Equal(1, _fixture.Faults.Triggered);
        }

        Assert.Equal((0, 0), await CountTaskAsync(title));
        Assert.Empty(NewEvents(org.Id, before));
    }

    [Fact]
    public async Task Organization_task_transient_failure_is_retried_without_duplicates()
    {
        var (owner, admin, org) = await CreateOrganizationWithAdminAsync();
        var title = $"Org task {Guid.NewGuid():N}";
        var before = _fixture.Notifications.EventsFor(org.Id).Length;

        // A TimeoutException is transient for SqlServerRetryingExecutionStrategy: the whole transaction is
        // retried. The first attempt already inserted the task (then rolled back), so the retry only works
        // if it starts from a clean change tracker.
        using (_fixture.Faults.Arm(AssignmentSaveFor(title), () => new TimeoutException("Simulated transient failure."), times: 1))
        {
            var response = await PostOrganizationTaskAsync(owner, org.Id, title, owner.Id, admin.Id);
            Assert.True(response.StatusCode == HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
            Assert.Equal(1, _fixture.Faults.Triggered);
        }

        Assert.Equal((1, 2), await CountTaskAsync(title));
        Assert.Equal(new[] { "TaskCreated" }, NewEvents(org.Id, before));
    }

    [Fact]
    public async Task Personal_organization_task_succeeds_and_a_failure_rolls_back()
    {
        var (_, admin, org) = await CreateOrganizationWithAdminAsync();
        var failing = $"Personal {Guid.NewGuid():N}";
        var working = $"Personal {Guid.NewGuid():N}";
        var before = _fixture.Notifications.EventsFor(org.Id).Length;

        using (_fixture.Faults.Arm(AssignmentSaveFor(failing), () => new InvalidOperationException("Forced failure inside the transaction.")))
        {
            var failed = await PostPersonalTaskAsync(admin, org.Id, failing);
            Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        }

        Assert.Equal((0, 0), await CountTaskAsync(failing));
        Assert.Empty(NewEvents(org.Id, before));

        var created = await PostPersonalTaskAsync(admin, org.Id, working);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal((1, 1), await CountTaskAsync(working));
        Assert.Equal(new[] { "TaskCreated" }, NewEvents(org.Id, before));
    }

    [Fact]
    public async Task Promote_issue_to_task_succeeds_and_a_failure_leaves_the_issue_unconverted()
    {
        var (owner, admin, org) = await CreateOrganizationWithAdminAsync();
        var issueTitle = $"Issue {Guid.NewGuid():N}";
        var issueId = await CreateIssueAsync(owner, org.Id, issueTitle);
        var events = _fixture.Notifications.EventsFor(org.Id).Length; // panel/issue creation events

        var promote = new
        {
            organizationId = org.Id,
            issueId,
            start = "2026-10-12T08:00:00.000Z",
            duration = 1.5,
            assigneeIds = new[] { admin.Id }
        };
        var url = $"/api/organizations/{org.Id}/issues/{issueId}/promote-to-task";

        // Fails the second SaveChanges (assignments + issue update), after the task row was written.
        using (_fixture.Faults.Arm(AssignmentSaveFor(issueTitle), () => new InvalidOperationException("Forced failure inside the transaction.")))
        {
            var failed = await owner.Client.PostAsJsonAsync(url, promote);
            Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        }

        Assert.Equal((0, 0), await CountTaskAsync(issueTitle));
        Assert.Null(await ReadIssueConversionAsync(issueId));
        Assert.Equal(events, _fixture.Notifications.EventsFor(org.Id).Length);

        var promoted = await owner.Client.PostAsJsonAsync(url, promote);
        Assert.True(promoted.StatusCode == HttpStatusCode.Created, await promoted.Content.ReadAsStringAsync());
        using var body = JsonDocument.Parse(await promoted.Content.ReadAsStringAsync());
        var taskId = body.RootElement.GetProperty("id").GetGuid();

        Assert.Equal((1, 1), await CountTaskAsync(issueTitle));
        Assert.Equal(taskId, await ReadIssueConversionAsync(issueId));
        Assert.Equal(new[] { "TaskCreated", "IssueDeleted" }, _fixture.Notifications.EventsFor(org.Id).Skip(events));
    }

    [Fact]
    public async Task Accept_invitation_succeeds_and_a_failure_keeps_the_invitation_pending()
    {
        var owner = await _fixture.CreateUserAsync();
        var invitee = await _fixture.CreateUserAsync();
        var org = await CreateOrganizationAsync(owner);

        var invite = await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new
        {
            organizationId = org.Id,
            email = invitee.Email,
            role = OrganizationRoles.Member
        });
        Assert.True(invite.StatusCode == HttpStatusCode.Created, await invite.Content.ReadAsStringAsync());
        using var inviteBody = JsonDocument.Parse(await invite.Content.ReadAsStringAsync());
        var invitationId = inviteBody.RootElement.GetProperty("id").GetGuid();
        var token = await ReadInvitationAsync(invitationId, i => i.Token);
        var url = $"/api/invitations/{Uri.EscapeDataString(token)}/accept";
        var before = _fixture.Notifications.EventsFor(org.Id).Length;

        using (_fixture.Faults.Arm(
                   ctx => ctx.ChangeTracker.Entries<OrganizationInvitation>()
                       .Any(e => e.Entity.Id == invitationId && e.State == EntityState.Modified),
                   () => new InvalidOperationException("Forced failure inside the transaction.")))
        {
            var failed = await invitee.Client.PostAsync(url, null);
            Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        }

        Assert.Equal(InvitationStatus.Pending, await ReadInvitationAsync(invitationId, i => i.Status));
        Assert.Null(await ReadMembershipAsync(org.Id, invitee.Id));
        Assert.Empty(NewEvents(org.Id, before));

        var accepted = await invitee.Client.PostAsync(url, null);
        Assert.True(accepted.StatusCode == HttpStatusCode.OK, await accepted.Content.ReadAsStringAsync());

        Assert.Equal(InvitationStatus.Accepted, await ReadInvitationAsync(invitationId, i => i.Status));
        var membership = await ReadMembershipAsync(org.Id, invitee.Id);
        Assert.NotNull(membership);
        Assert.Equal((OrganizationRoles.Member, MembershipStatus.Active), (membership!.Role, membership.Status));
        Assert.Equal(new[] { "MemberJoined" }, NewEvents(org.Id, before));
    }

    [Fact]
    public async Task Transfer_ownership_succeeds_and_a_failure_changes_nothing()
    {
        var (owner, admin, org) = await CreateOrganizationWithAdminAsync();
        var url = $"/api/organizations/{org.Id}/transfer-ownership";
        var body = new { organizationId = org.Id, newOwnerUserId = admin.Id };
        var before = _fixture.Notifications.EventsFor(org.Id).Length;

        using (_fixture.Faults.Arm(
                   ctx => ctx.ChangeTracker.Entries<Organization>()
                       .Any(e => e.Entity.Id == org.Id && e.State == EntityState.Modified),
                   () => new InvalidOperationException("Forced failure inside the transaction.")))
        {
            var failed = await owner.Client.PostAsJsonAsync(url, body);
            Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        }

        Assert.Equal(owner.Id, await ReadOwnerAsync(org.Id));
        Assert.Equal(OrganizationRoles.Owner, (await ReadMembershipAsync(org.Id, owner.Id))!.Role);
        Assert.Equal(OrganizationRoles.Admin, (await ReadMembershipAsync(org.Id, admin.Id))!.Role);
        Assert.Empty(NewEvents(org.Id, before));

        var transferred = await owner.Client.PostAsJsonAsync(url, body);
        Assert.True(transferred.StatusCode == HttpStatusCode.NoContent, await transferred.Content.ReadAsStringAsync());

        Assert.Equal(admin.Id, await ReadOwnerAsync(org.Id));
        Assert.Equal(OrganizationRoles.Admin, (await ReadMembershipAsync(org.Id, owner.Id))!.Role);
        Assert.Equal(OrganizationRoles.Owner, (await ReadMembershipAsync(org.Id, admin.Id))!.Role);
        Assert.Equal(
            new[] { "OwnershipTransferred", "MemberRoleUpdated", "MemberRoleUpdated" },
            NewEvents(org.Id, before));
    }

    private string[] NewEvents(Guid organizationId, int before) =>
        _fixture.Notifications.EventsFor(organizationId).Skip(before).ToArray();

    // --- Setup through the API ---

    internal sealed record OrganizationInfo(Guid Id, string AdminJoinCode);

    private static async Task<OrganizationInfo> CreateOrganizationAsync(TestUser owner)
    {
        var response = await owner.Client.PostAsJsonAsync("/api/organizations", new { name = $"Org {Guid.NewGuid():N}" });
        var content = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, $"{(int)response.StatusCode}: {content}");
        using var body = JsonDocument.Parse(content);
        return new OrganizationInfo(
            body.RootElement.GetProperty("id").GetGuid(),
            body.RootElement.GetProperty("adminJoinCode").GetString()!);
    }

    private async Task<(TestUser Owner, TestUser Admin, OrganizationInfo Org)> CreateOrganizationWithAdminAsync()
    {
        var owner = await _fixture.CreateUserAsync();
        var admin = await _fixture.CreateUserAsync();
        var org = await CreateOrganizationAsync(owner);

        var join = await admin.Client.PostAsJsonAsync("/api/organizations/join", new { joinCode = org.AdminJoinCode });
        Assert.True(join.StatusCode == HttpStatusCode.OK, await join.Content.ReadAsStringAsync());
        return (owner, admin, org);
    }

    private static Task<HttpResponseMessage> PostOrganizationTaskAsync(
        TestUser creator, Guid organizationId, string title, params Guid[] assigneeIds) =>
        creator.Client.PostAsJsonAsync($"/api/organizations/{organizationId}/tasks", new
        {
            organizationId,
            title,
            start = "2026-10-12T08:00:00.000Z",
            duration = 1.5,
            categoryId = creator.CategoryId,
            assigneeIds
        });

    private static Task<HttpResponseMessage> PostPersonalTaskAsync(TestUser member, Guid organizationId, string title) =>
        member.Client.PostAsJsonAsync($"/api/organizations/{organizationId}/tasks/personal", new
        {
            organizationId,
            title,
            start = "2026-10-12T10:00:00.000Z",
            duration = 0.75,
            categoryId = member.CategoryId
        });

    private static async Task<Guid> CreateIssueAsync(TestUser admin, Guid organizationId, string title)
    {
        var panel = await admin.Client.PostAsJsonAsync($"/api/organizations/{organizationId}/issue-panels", new
        {
            organizationId,
            name = "Backlog"
        });
        Assert.True(panel.StatusCode == HttpStatusCode.Created, await panel.Content.ReadAsStringAsync());
        using var panelBody = JsonDocument.Parse(await panel.Content.ReadAsStringAsync());
        var panelId = panelBody.RootElement.GetProperty("id").GetGuid();

        var issue = await admin.Client.PostAsJsonAsync($"/api/organizations/{organizationId}/issue-panels/{panelId}/issues", new
        {
            organizationId,
            panelId,
            title,
            notes = (string?)null,
            categoryId = admin.CategoryId
        });
        Assert.True(issue.StatusCode == HttpStatusCode.Created, await issue.Content.ReadAsStringAsync());
        using var issueBody = JsonDocument.Parse(await issue.Content.ReadAsStringAsync());
        return issueBody.RootElement.GetProperty("id").GetGuid();
    }

    // Matches the SaveChanges that inserts the assignments of the task with this title
    // (that task was already inserted by an earlier SaveChanges in the same transaction).
    private static Func<DbContext, bool> AssignmentSaveFor(string title) => ctx =>
        ctx.ChangeTracker.Entries<TaskAssignment>().Any(e => e.State == EntityState.Added)
        && ctx.ChangeTracker.Entries<TaskItem>().Any(e => e.Entity.Title == title);

    // --- Database reads ---

    private async Task<(int Tasks, int Assignments)> CountTaskAsync(string title)
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var taskIds = await db.Tasks.IgnoreQueryFilters().Where(t => t.Title == title).Select(t => t.Id).ToListAsync();
        var assignments = await db.TaskAssignments.IgnoreQueryFilters().CountAsync(a => taskIds.Contains(a.TaskItemId));
        return (taskIds.Count, assignments);
    }

    private async Task<Guid?> ReadIssueConversionAsync(Guid issueId)
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        return await db.Issues.IgnoreQueryFilters().Where(i => i.Id == issueId).Select(i => i.ConvertedToTaskItemId).SingleAsync();
    }

    private async Task<T> ReadInvitationAsync<T>(Guid invitationId, System.Linq.Expressions.Expression<Func<OrganizationInvitation, T>> select)
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        return await db.OrganizationInvitations.IgnoreQueryFilters().Where(i => i.Id == invitationId).Select(select).SingleAsync();
    }

    private async Task<OrganizationMembership?> ReadMembershipAsync(Guid organizationId, Guid userId)
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        return await db.OrganizationMemberships.AsNoTracking().IgnoreQueryFilters()
            .SingleOrDefaultAsync(m => m.OrganizationId == organizationId && m.UserId == userId);
    }

    private async Task<Guid> ReadOwnerAsync(Guid organizationId)
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        return await db.Organizations.IgnoreQueryFilters().Where(o => o.Id == organizationId).Select(o => o.OwnerId).SingleAsync();
    }
}
