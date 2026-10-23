using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace TimePlanner.API.Tests.Integration;

/// <summary>
/// Command validators now run (MediatR ValidationBehavior) and every 400 has the same body,
/// { message, errors }, with a message the frontend can show as-is.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class ValidationApiTests
{
    private readonly ApiFixture _fixture;

    public ValidationApiTests(ApiFixture fixture) => _fixture = fixture;

    [Theory]
    [InlineData(0, "Duration must be greater than 0 hours.")]
    [InlineData(-1, "Duration must be greater than 0 hours.")]
    [InlineData(24.25, "Duration can't be longer than 24 hours.")]
    public async Task Creating_a_task_with_an_invalid_duration_returns_400_with_a_readable_message(double duration, string message)
    {
        var user = await _fixture.CreateUserAsync();

        var response = await user.Client.PostAsJsonAsync("/api/tasks", TaskBody(user, "Plan", "2026-10-13T08:00:00.000Z", duration));

        await AssertBadRequestAsync(response, message);
    }

    [Fact]
    public async Task Creating_a_task_requires_a_title_but_not_a_length_limit()
    {
        var user = await _fixture.CreateUserAsync();

        await AssertBadRequestAsync(
            await user.Client.PostAsJsonAsync("/api/tasks", TaskBody(user, "   ", "2026-10-13T08:00:00.000Z", 1)),
            "Title is required.");

        var longTitle = new string('t', 5000); // task titles are intentionally unlimited
        var created = await user.Client.PostAsJsonAsync("/api/tasks", TaskBody(user, longTitle, "2026-10-13T09:00:00.000Z", 1));
        Assert.True(created.StatusCode == HttpStatusCode.Created, await created.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData(24)]          // the planner's maximum
    [InlineData(1.0 / 60)]    // the editor works in whole minutes
    [InlineData(0.25)]
    public async Task Durations_the_planner_can_produce_are_accepted(double duration)
    {
        var user = await _fixture.CreateUserAsync();

        var response = await user.Client.PostAsJsonAsync("/api/tasks", TaskBody(user, "Plan", "2026-10-14T00:00:00.000Z", duration));

        Assert.True(response.StatusCode == HttpStatusCode.Created, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Updating_a_task_validates_the_same_rules_and_still_accepts_valid_changes()
    {
        var user = await _fixture.CreateUserAsync();
        var created = await user.Client.PostAsJsonAsync("/api/tasks", TaskBody(user, "Plan", "2026-10-15T08:00:00.000Z", 1));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var body = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var id = body.RootElement.GetProperty("id").GetGuid();

        await AssertBadRequestAsync(
            await user.Client.PutAsJsonAsync($"/api/tasks/{id}", TaskBody(user, "Plan", "2026-10-15T08:00:00.000Z", 0)),
            "Duration must be greater than 0 hours.");
        await AssertBadRequestAsync(
            await user.Client.PutAsJsonAsync($"/api/tasks/{id}", TaskBody(user, "Plan", "2026-10-15T08:00:00.000Z", -1)),
            "Duration must be greater than 0 hours.");

        var updated = await user.Client.PutAsJsonAsync($"/api/tasks/{id}", TaskBody(user, "Plan v2", "2026-10-15T08:30:00.000Z", 1.5));
        Assert.True(updated.StatusCode == HttpStatusCode.NoContent, await updated.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Several_failures_are_combined_into_one_message_and_listed_in_errors()
    {
        var user = await _fixture.CreateUserAsync();

        var response = await user.Client.PostAsJsonAsync("/api/tasks", new
        {
            title = "",
            start = "2026-10-13T08:00:00.000Z",
            duration = 0,
            categoryId = Guid.Empty
        });

        var errors = await AssertBadRequestAsync(response,
            "Title is required. Duration must be greater than 0 hours. Category is required.");
        Assert.Equal(new[] { "Title is required.", "Duration must be greater than 0 hours.", "Category is required." }, errors);
    }

    [Fact]
    public async Task Template_rules_are_enforced_with_readable_messages()
    {
        var user = await _fixture.CreateUserAsync();

        await AssertBadRequestAsync(
            await user.Client.PostAsJsonAsync("/api/tasktemplates", new { title = "", duration = 1, categoryId = user.CategoryId }),
            "Template title is required.");
        await AssertBadRequestAsync(
            await user.Client.PostAsJsonAsync("/api/tasktemplates", new { title = new string('x', 201), duration = 1, categoryId = user.CategoryId }),
            "Template title can be at most 200 characters.");
        await AssertBadRequestAsync(
            await user.Client.PostAsJsonAsync("/api/tasktemplates", new { title = "Standup", duration = 0, categoryId = user.CategoryId }),
            "Duration must be greater than 0 hours.");

        var created = await user.Client.PostAsJsonAsync("/api/tasktemplates", new { title = new string('x', 200), duration = 0.25, categoryId = user.CategoryId });
        Assert.True(created.StatusCode == HttpStatusCode.Created, await created.Content.ReadAsStringAsync());
        using var body = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var id = body.RootElement.GetProperty("id").GetGuid();

        await AssertBadRequestAsync(
            await user.Client.PutAsJsonAsync($"/api/tasktemplates/{id}", new { title = "Standup", duration = 25, categoryId = user.CategoryId }),
            "Duration can't be longer than 24 hours.");
        var updated = await user.Client.PutAsJsonAsync($"/api/tasktemplates/{id}", new { title = "Standup", duration = 24, categoryId = user.CategoryId });
        Assert.True(updated.StatusCode == HttpStatusCode.NoContent, await updated.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Category_rules_are_enforced_on_create_and_update()
    {
        var user = await _fixture.CreateUserAsync();

        await AssertBadRequestAsync(
            await user.Client.PostAsJsonAsync("/api/categories", new { name = "", color = "#123456" }),
            "Category name is required.");
        await AssertBadRequestAsync(
            await user.Client.PostAsJsonAsync("/api/categories", new { name = new string('n', 101), color = "#123456" }),
            "Category name can be at most 100 characters.");
        await AssertBadRequestAsync(
            await user.Client.PostAsJsonAsync("/api/categories", new { name = "Gym", color = "#abc" }),
            "Color must be a hex color like #2F7FE0.");

        var created = await user.Client.PostAsJsonAsync("/api/categories", new { name = "Gym", color = "#2f7fe0" });
        Assert.True(created.StatusCode == HttpStatusCode.Created, await created.Content.ReadAsStringAsync());
        using var body = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var id = body.RootElement.GetProperty("id").GetGuid();

        // Updates were never validated before; an 8-character color used to reach the nvarchar(7) column.
        await AssertBadRequestAsync(
            await user.Client.PutAsJsonAsync($"/api/categories/{id}", new { name = "Gym", color = "#12345678" }),
            "Color must be a hex color like #2F7FE0.");
        var updated = await user.Client.PutAsJsonAsync($"/api/categories/{id}", new { name = "Gym & swim", color = "#0E9C8C" });
        Assert.True(updated.StatusCode == HttpStatusCode.NoContent, await updated.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Organization_task_commands_are_validated_once_with_the_same_error_shape()
    {
        var owner = await _fixture.CreateUserAsync();
        var org = await owner.Client.PostAsJsonAsync("/api/organizations", new { name = $"Org {Guid.NewGuid():N}" });
        Assert.Equal(HttpStatusCode.Created, org.StatusCode);
        using var orgBody = JsonDocument.Parse(await org.Content.ReadAsStringAsync());
        var orgId = orgBody.RootElement.GetProperty("id").GetGuid();

        object OrgTask(string title, double duration) => new
        {
            organizationId = orgId,
            title,
            start = "2026-10-16T08:00:00.000Z",
            duration,
            categoryId = owner.CategoryId,
            assigneeIds = new[] { owner.Id }
        };

        // Previously answered by MVC auto-validation as ValidationProblemDetails (no "message").
        await AssertBadRequestAsync(
            await owner.Client.PostAsJsonAsync($"/api/organizations/{orgId}/tasks", OrgTask("Review", 0)),
            "Duration must be greater than 0 hours.");

        // Org tasks are TaskItems too: the old 200-character limit contradicted the unlimited task title.
        var created = await owner.Client.PostAsJsonAsync($"/api/organizations/{orgId}/tasks", OrgTask(new string('r', 300), 1));
        Assert.True(created.StatusCode == HttpStatusCode.Created, await created.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Model_binding_errors_use_the_same_error_shape()
    {
        var user = await _fixture.CreateUserAsync();

        var badDate = await user.Client.PostAsJsonAsync("/api/tasks", new
        {
            title = "Plan",
            start = "not a date",
            duration = 1,
            categoryId = user.CategoryId
        });
        var errors = await AssertBadRequestAsync(badDate, "Some of the submitted values are missing or invalid.");
        Assert.NotEmpty(errors);

        var malformed = await user.Client.PostAsync("/api/tasks", new StringContent("{ not json", Encoding.UTF8, "application/json"));
        await AssertBadRequestAsync(malformed, "Some of the submitted values are missing or invalid.");
    }

    [Fact]
    public async Task Handler_validation_errors_now_carry_their_own_message()
    {
        var user = await _fixture.CreateUserAsync();
        var unknownCategory = Guid.NewGuid();

        var response = await user.Client.PostAsJsonAsync("/api/tasks", new
        {
            title = "Plan",
            start = "2026-10-17T08:00:00.000Z",
            duration = 1,
            categoryId = unknownCategory
        });

        // Was the generic "One or more validation errors occurred."
        await AssertBadRequestAsync(response, $"Category with ID {unknownCategory} not found for this user.");
    }

    [Fact]
    public async Task Auth_commands_are_validated_with_one_clear_message_per_field()
    {
        var client = _fixture.Factory.CreateClient();

        var register = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email = $"weak-{Guid.NewGuid():N}@tests.local",
            password = "short"
        });
        var errors = await AssertBadRequestAsync(register, "Password must be at least 8 characters long.");
        Assert.Single(errors);

        var login = await client.PostAsJsonAsync("/api/auth/login", new { email = "not-an-email", password = "whatever" });
        await AssertBadRequestAsync(login, "A valid email address is required.");
    }

    private static object TaskBody(TestUser user, string title, string start, double duration) =>
        new { title, start, duration, categoryId = user.CategoryId };

    private static async Task<string[]> AssertBadRequestAsync(HttpResponseMessage response, string expectedMessage)
    {
        var content = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.BadRequest, $"{(int)response.StatusCode}: {content}");
        using var body = JsonDocument.Parse(content);
        Assert.Equal(expectedMessage, body.RootElement.GetProperty("message").GetString());
        return body.RootElement.GetProperty("errors").EnumerateArray().Select(e => e.GetString()!).ToArray();
    }
}
