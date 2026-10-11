using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TimePlanner.API.Data;

namespace TimePlanner.API.Tests.Integration;

[Collection(ApiCollection.Name)]
public sealed class RegisterMigrationApiTests
{
    private readonly ApiFixture _fixture;

    public RegisterMigrationApiTests(ApiFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Guest_tasks_are_migrated_as_utc_and_unreadable_starts_are_skipped()
    {
        var email = $"guest-{Guid.NewGuid():N}@tests.local";
        var client = _fixture.Factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = ApiFixture.Password,
            migrationData = new
            {
                categories = new[] { new { id = "c1", name = "Home", color = "#123456" } },
                templates = Array.Empty<object>(),
                tasks = new[]
                {
                    new { title = "z", start = "2026-10-03T07:00:00.000Z", duration = 1.0, categoryId = "c1", templateId = (string?)null },
                    new { title = "offset", start = "2026-10-03T10:00:00+02:00", duration = 1.0, categoryId = "c1", templateId = (string?)null },
                    new { title = "broken", start = "not a date", duration = 1.0, categoryId = "c1", templateId = (string?)null }
                }
            }
        });

        Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var tasks = await db.Tasks.AsNoTracking()
            .Where(t => t.User.Email == email)
            .OrderBy(t => t.Start)
            .Select(t => new { t.Title, t.Start })
            .ToListAsync();

        Assert.Equal(new[] { "z", "offset" }, tasks.Select(t => t.Title));
        Assert.Equal(new DateTime(2026, 10, 3, 7, 0, 0, DateTimeKind.Utc), tasks[0].Start);
        Assert.Equal(new DateTime(2026, 10, 3, 8, 0, 0, DateTimeKind.Utc), tasks[1].Start);
    }

    [Fact]
    public async Task Failed_migration_still_rolls_back_the_new_user()
    {
        var email = $"guest-{Guid.NewGuid():N}@tests.local";
        var client = _fixture.Factory.CreateClient();

        // Category names are limited to 100 characters in the database, so the migration fails.
        var response = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = ApiFixture.Password,
            migrationData = new
            {
                categories = new[] { new { id = "c1", name = new string('x', 150), color = "#123456" } },
                templates = Array.Empty<object>(),
                tasks = Array.Empty<object>()
            }
        });

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);

        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        Assert.False(await db.Users.AnyAsync(u => u.Email == email));
    }

    [Fact]
    public async Task Items_in_the_guest_Other_category_move_into_the_account_Other_category()
    {
        // As the frontend sends it: the guest's own "Other" (id g-other) is left out of the categories.
        var email = await RegisterAsync(new
        {
            categories = new[]
            {
                new { id = "g-work", name = "Work", color = "#0000FF" },
                new { id = "g-gym", name = "Gym", color = "#00FF00" }
            },
            templates = new[]
            {
                new { id = "t-other", title = "Inbox zero", duration = 0.5, categoryId = "g-other" },
                new { id = "t-work", title = "Standup", duration = 0.25, categoryId = "g-work" }
            },
            tasks = new[]
            {
                GuestTask("o1", "2026-10-01T07:00:00.000Z", "g-other"),
                GuestTask("o2", "2026-10-01T08:00:00.000Z", "g-other"),
                GuestTask("o3", "2026-10-01T09:00:00.000Z", "g-other"),
                GuestTask("w1", "2026-10-01T10:00:00.000Z", "g-work"),
                GuestTask("gym1", "2026-10-01T11:00:00.000Z", "g-gym"),
                GuestTask("Inbox zero", "2026-10-01T12:00:00.000Z", "g-other", "t-other"),
                GuestTask("Standup", "2026-10-01T13:00:00.000Z", "g-work", "t-work"),
                GuestTask("orphan", "2026-10-01T14:00:00.000Z", "g-deleted-long-ago")
            }
        });

        var account = await LoadAccountAsync(email);

        Assert.Equal(new[] { "Gym", "Other", "Work" }, account.CategoryNames);
        Assert.Equal(
            new[] { ("Inbox zero", "Other"), ("Standup", "Work") },
            account.Templates.OrderBy(t => t.Title).ToArray());
        Assert.Equal(8, account.Tasks.Length); // nothing dropped
        Assert.Equal(
            new[] { "Inbox zero", "o1", "o2", "o3", "orphan" },
            account.Tasks.Where(t => t.Category == "Other").Select(t => t.Title).OrderBy(t => t, StringComparer.Ordinal).ToArray());
        Assert.Equal(
            new[] { "Standup", "w1" },
            account.Tasks.Where(t => t.Category == "Work").Select(t => t.Title).OrderBy(t => t, StringComparer.Ordinal).ToArray());
        Assert.Equal(new[] { "gym1" }, account.Tasks.Where(t => t.Category == "Gym").Select(t => t.Title).ToArray());
        Assert.Equal(2, account.Tasks.Count(t => t.FromTemplate));
    }

    [Fact]
    public async Task A_guest_who_only_used_Other_gets_every_task_and_template()
    {
        // No categories are sent at all (previously this skipped the whole migration).
        var email = await RegisterAsync(new
        {
            categories = Array.Empty<object>(),
            templates = new[] { new { id = "t1", title = "Read", duration = 1.0, categoryId = "g-other" } },
            tasks = new[]
            {
                GuestTask("a", "2026-10-02T07:00:00.000Z", "g-other"),
                GuestTask("b", "2026-10-02T08:00:00.000Z", "g-other"),
                GuestTask("Read", "2026-10-02T09:00:00.000Z", "g-other", "t1")
            }
        });

        var account = await LoadAccountAsync(email);

        Assert.Equal(new[] { "Other" }, account.CategoryNames);
        Assert.Equal(new[] { ("Read", "Other") }, account.Templates);
        Assert.Equal(3, account.Tasks.Length);
        Assert.All(account.Tasks, t => Assert.Equal("Other", t.Category));
    }

    [Fact]
    public async Task A_sent_Other_category_and_repeated_names_are_merged_not_duplicated()
    {
        var email = await RegisterAsync(new
        {
            categories = new[]
            {
                new { id = "g-other", name = "other", color = "#999999" },
                new { id = "g-work", name = "Work", color = "#0000FF" },
                new { id = "g-work-2", name = "work ", color = "#0000AA" }
            },
            templates = Array.Empty<object>(),
            tasks = new[]
            {
                GuestTask("o", "2026-10-03T07:00:00.000Z", "g-other"),
                GuestTask("w", "2026-10-03T08:00:00.000Z", "g-work"),
                GuestTask("w2", "2026-10-03T09:00:00.000Z", "g-work-2")
            }
        });

        var account = await LoadAccountAsync(email);

        Assert.Equal(new[] { "Other", "Work" }, account.CategoryNames);
        Assert.Equal(new[] { ("o", "Other") }, account.Tasks.Where(t => t.Category == "Other").Select(t => (t.Title, t.Category)).ToArray());
        Assert.Equal(new[] { "w", "w2" }, account.Tasks.Where(t => t.Category == "Work").Select(t => t.Title).OrderBy(t => t).ToArray());
    }

    private static object GuestTask(string title, string start, string categoryId, string? templateId = null) =>
        new { title, start, duration = 1.0, categoryId, templateId };

    private async Task<string> RegisterAsync(object migrationData)
    {
        var email = $"guest-{Guid.NewGuid():N}@tests.local";
        var client = _fixture.Factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            password = ApiFixture.Password,
            migrationData
        });

        Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return email;
    }

    private async Task<MigratedAccount> LoadAccountAsync(string email)
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        var userId = await db.Users.Where(u => u.Email == email).Select(u => u.Id).SingleAsync();
        var categories = await db.Categories.AsNoTracking()
            .Where(c => c.UserId == userId)
            .Select(c => new { c.Id, c.Name })
            .ToListAsync();
        var names = categories.ToDictionary(c => c.Id, c => c.Name);
        var templates = await db.TaskTemplates.AsNoTracking()
            .Where(t => t.UserId == userId)
            .Select(t => new { t.Title, t.CategoryId })
            .ToListAsync();
        var tasks = await db.Tasks.AsNoTracking()
            .Where(t => t.UserId == userId)
            .Select(t => new { t.Title, t.CategoryId, t.TemplateId })
            .ToListAsync();

        return new MigratedAccount(
            categories.Select(c => c.Name).OrderBy(n => n, StringComparer.Ordinal).ToArray(),
            templates.Select(t => (t.Title, names[t.CategoryId])).ToArray(),
            tasks.Select(t => (t.Title, names[t.CategoryId], t.TemplateId.HasValue)).ToArray());
    }

    private sealed record MigratedAccount(
        string[] CategoryNames,
        (string Title, string Category)[] Templates,
        (string Title, string Category, bool FromTemplate)[] Tasks);
}
