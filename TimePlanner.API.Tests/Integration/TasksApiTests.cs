using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using TimePlanner.API.Data;
using TimePlanner.API.Models;
using TimePlanner.API.Utilities.Json;
using Xunit.Abstractions;

namespace TimePlanner.API.Tests.Integration;

[Collection(ApiCollection.Name)]
public sealed class TasksApiTests
{
    private const string OverlapMessage = "This time slot overlaps with an existing task.";

    private readonly ApiFixture _fixture;
    private readonly ITestOutputHelper _output;

    public TasksApiTests(ApiFixture fixture, ITestOutputHelper output)
    {
        _fixture = fixture;
        _output = output;
    }

    [Fact]
    public async Task Created_task_round_trips_as_the_exact_utc_instant()
    {
        var user = await _fixture.CreateUserAsync();

        // Oslo user clicks 09:00 on Sat 2026-10-03 (UTC+2): the client sends 07:00Z.
        var created = await CreateTaskAsync(user, "2026-10-03T07:00:00.000Z", 1);
        Assert.Equal("2026-10-03T07:00:00.000Z", created.GetProperty("start").GetString());

        // Reload the Oslo week [Mon 00:00 local, next Mon 00:00 local) as the frontend does.
        var week = await GetTasksAsync(user, "2026-09-27T22:00:00.000Z", "2026-10-04T22:00:00.000Z");
        var task = Assert.Single(week);
        Assert.Equal("2026-10-03T07:00:00.000Z", task.GetProperty("start").GetString());

        Assert.Equal("2026-10-03 07:00:00.0000000", await ReadRawStartAsync(task.GetProperty("id").GetGuid()));
    }

    [Fact]
    public async Task Body_instants_with_an_offset_or_without_one_are_stored_as_utc()
    {
        var user = await _fixture.CreateUserAsync();

        var withOffset = await CreateTaskAsync(user, "2026-10-03T09:00:00+02:00", 1);
        Assert.Equal("2026-10-03T07:00:00.000Z", withOffset.GetProperty("start").GetString());
        Assert.Equal("2026-10-03 07:00:00.0000000", await ReadRawStartAsync(withOffset.GetProperty("id").GetGuid()));

        // Lenient contract: a value without an offset is UTC (not the server's local time).
        var withoutOffset = await CreateTaskAsync(user, "2026-10-04T07:00:00", 1);
        Assert.Equal("2026-10-04T07:00:00.000Z", withoutOffset.GetProperty("start").GetString());
        Assert.Equal("2026-10-04 07:00:00.0000000", await ReadRawStartAsync(withoutOffset.GetProperty("id").GetGuid()));
    }

    [Theory]
    // 'Z' (what the frontend sends)
    [InlineData("2026-10-03T07:00:00.000Z", "2026-10-03T08:00:00.000Z", true)]
    // explicit offsets are converted to UTC by the model binder
    [InlineData("2026-10-03T09:00:00+02:00", "2026-10-03T10:00:00+02:00", true)]
    [InlineData("2026-10-03T02:00:00-05:00", "2026-10-03T03:00:00-05:00", true)]
    // no offset: treated as UTC, not as server-local time (this machine runs Europe/Oslo)
    [InlineData("2026-10-03T07:00:00", "2026-10-03T08:00:00", true)]
    [InlineData("2026-10-03T07:00:01", "2026-10-03T08:00:00", false)]
    public async Task Query_string_instants_are_bound_as_utc(string startDate, string endDate, bool expectTask)
    {
        var user = await _fixture.CreateUserAsync();
        await CreateTaskAsync(user, "2026-10-03T07:00:00.000Z", 1);

        var tasks = await GetTasksAsync(user, startDate, endDate);

        Assert.Equal(expectTask ? 1 : 0, tasks.Count);
    }

    [Fact]
    public async Task Range_is_half_open_and_no_longer_extended_by_a_day()
    {
        var user = await _fixture.CreateUserAsync();
        await CreateTaskAsync(user, "2026-10-05T00:00:00.000Z", 0.5, "at start");
        await CreateTaskAsync(user, "2026-10-05T23:00:00.000Z", 0.5, "inside");
        await CreateTaskAsync(user, "2026-10-06T00:00:00.000Z", 0.5, "at end");
        await CreateTaskAsync(user, "2026-10-06T10:00:00.000Z", 0.5, "next day");

        var tasks = await GetTasksAsync(user, "2026-10-05T00:00:00.000Z", "2026-10-06T00:00:00.000Z");

        Assert.Equal(
            new[] { "at start", "inside" },
            tasks.Select(t => t.GetProperty("title").GetString()).OrderBy(t => t).ToArray());
    }

    [Theory]
    [InlineData("/api/tasks?startDate=2026-10-05T00:00:00.000Z")]
    [InlineData("/api/tasks?endDate=2026-10-05T00:00:00.000Z")]
    [InlineData("/api/tasks?startDate=2026-10-05T00:00:00.000Z&endDate=2026-10-05T00:00:00.000Z")]
    [InlineData("/api/tasks?startDate=2026-10-06T00:00:00.000Z&endDate=2026-10-05T00:00:00.000Z")]
    [InlineData("/api/tasks?startDate=2025-01-01T00:00:00.000Z&endDate=2026-10-05T00:00:00.000Z")]
    [InlineData("/api/tasks/analytics?startDate=2026-10-05T00:00:00.000Z&endDate=2026-10-06T00:00:00.000Z&viewType=yearly")]
    [InlineData("/api/tasks/analytics?startDate=2026-10-05T00:00:00.000Z&endDate=2026-10-06T00:00:00.000Z")]
    public async Task Invalid_ranges_and_view_types_return_400_with_a_message(string url)
    {
        var user = await _fixture.CreateUserAsync();

        var response = await user.Client.GetAsync(url);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(string.IsNullOrWhiteSpace(body.RootElement.GetProperty("message").GetString()));
    }

    [Fact]
    public async Task Malformed_query_instant_returns_400()
    {
        var user = await _fixture.CreateUserAsync();

        var response = await user.Client.GetAsync("/api/tasks?startDate=not-a-date&endDate=2026-10-05T00:00:00.000Z");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Fractional_durations_are_honoured_by_the_overlap_check_and_conflicts_return_409()
    {
        var user = await _fixture.CreateUserAsync();
        await CreateTaskAsync(user, "2026-10-07T09:00:00.000Z", 1.5); // ends 10:30Z

        // Starts inside the 1.5h task (the old DATEADD(hour, CAST(1.5 AS int)) ended it at 10:00 and allowed this).
        var overlapping = await PostTaskAsync(user, "2026-10-07T10:00:00.000Z", 0.5);
        await AssertConflictAsync(overlapping, OverlapMessage);

        // Touching is not overlapping.
        var touching = await CreateTaskAsync(user, "2026-10-07T10:30:00.000Z", 0.5);

        // A 15-minute task (the old check treated it as zero length).
        await CreateTaskAsync(user, "2026-10-07T12:00:00.000Z", 0.25);
        await AssertConflictAsync(await PostTaskAsync(user, "2026-10-07T12:10:00.000Z", 0.25), OverlapMessage);

        // Update path.
        var update = await user.Client.PutAsJsonAsync($"/api/tasks/{touching.GetProperty("id").GetGuid()}", new
        {
            title = "moved",
            start = "2026-10-07T10:10:00.000Z", // inside 09:00-10:30 but after the truncated 10:00 end
            duration = 0.5,
            categoryId = user.CategoryId
        });
        await AssertConflictAsync(update, OverlapMessage);

        // From-template path.
        var templateResponse = await user.Client.PostAsJsonAsync("/api/tasktemplates", new
        {
            title = "Standup",
            duration = 0.75,
            categoryId = user.CategoryId
        });
        Assert.Equal(HttpStatusCode.Created, templateResponse.StatusCode);
        using var template = JsonDocument.Parse(await templateResponse.Content.ReadAsStringAsync());
        var fromTemplate = await user.Client.PostAsJsonAsync("/api/tasks/from-template", new
        {
            templateId = template.RootElement.GetProperty("id").GetGuid(),
            start = "2026-10-07T12:05:00.000Z" // 12:05-12:50 overlaps the 12:00-12:15 task
        });
        await AssertConflictAsync(fromTemplate, "The new task created from this template overlaps with an existing task.");
    }

    [Fact]
    public async Task Analytics_buckets_by_the_calendar_of_the_X_Time_Zone_header()
    {
        var user = await _fixture.CreateUserAsync();
        await CreateTaskAsync(user, "2026-10-04T22:30:00.000Z", 1); // Mon 2026-10-05 00:30 in Oslo, Sun 22:30 UTC
        await CreateTaskAsync(user, "2026-10-07T10:00:00.000Z", 2); // Wed

        // Oslo ISO week 41 = [2026-10-05 00:00+02:00, 2026-10-12 00:00+02:00)
        var oslo = await GetAnalyticsAsync(user, "2026-10-04T22:00:00.000Z", "2026-10-11T22:00:00.000Z", "daily", "Europe/Oslo");
        Assert.Equal(3, oslo.GetProperty("totalHours").GetDouble());
        Assert.Equal(new[] { "2026-10-05", "2026-10-07" }, Keys(oslo));
        Assert.Equal(new[] { "Monday", "Wednesday" }, Labels(oslo));
        Assert.Equal(new[] { 1d, 2d }, Values(oslo));
        var category = Assert.Single(oslo.GetProperty("timePerCategory").EnumerateArray());
        Assert.Equal("Work", category.GetProperty("categoryName").GetString());
        Assert.Equal("#3366FF", category.GetProperty("categoryColor").GetString());

        var weekly = await GetAnalyticsAsync(user, "2026-10-04T22:00:00.000Z", "2026-10-11T22:00:00.000Z", "weekly", "Europe/Oslo");
        Assert.Equal(new[] { "2026-W41" }, Keys(weekly));
        Assert.Equal(new[] { "Week 41" }, Labels(weekly));

        // Without the header (old clients) the UTC calendar is used: the first task is on Sunday.
        var utc = await GetAnalyticsAsync(user, "2026-10-04T00:00:00.000Z", "2026-10-11T00:00:00.000Z", "daily", null);
        Assert.Equal(new[] { "2026-10-04", "2026-10-07" }, Keys(utc));
        Assert.Equal(new[] { "Sunday", "Wednesday" }, Labels(utc));

        // Unknown or malformed zones fall back to UTC instead of failing.
        foreach (var bogus in new[] { "Mars/Olympus_Mons", "Europe/Oslo; DROP TABLE", new string('A', 65) })
        {
            var fallback = await GetAnalyticsAsync(user, "2026-10-04T00:00:00.000Z", "2026-10-11T00:00:00.000Z", "daily", bogus);
            Assert.Equal(new[] { "2026-10-04", "2026-10-07" }, Keys(fallback));
        }
    }

    [Fact]
    public async Task Monthly_analytics_use_local_months_and_template_totals_come_from_one_lookup()
    {
        var user = await _fixture.CreateUserAsync();
        await CreateTaskAsync(user, "2026-09-30T22:30:00.000Z", 1); // Oct 1 00:30 in Oslo, still September in UTC

        var templateResponse = await user.Client.PostAsJsonAsync("/api/tasktemplates", new
        {
            title = "Deep work",
            duration = 1.5,
            categoryId = user.CategoryId
        });
        Assert.Equal(HttpStatusCode.Created, templateResponse.StatusCode);
        using var template = JsonDocument.Parse(await templateResponse.Content.ReadAsStringAsync());
        var fromTemplate = await user.Client.PostAsJsonAsync("/api/tasks/from-template", new
        {
            templateId = template.RootElement.GetProperty("id").GetGuid(),
            start = "2026-10-15T08:00:00.000Z"
        });
        Assert.Equal(HttpStatusCode.Created, fromTemplate.StatusCode);

        // Oslo year 2026 = [2025-12-31T23:00Z, 2026-12-31T23:00Z)
        var oslo = await GetAnalyticsAsync(user, "2025-12-31T23:00:00.000Z", "2026-12-31T23:00:00.000Z", "monthly", "Europe/Oslo");
        Assert.Equal(new[] { "2026-10" }, Keys(oslo));
        Assert.Equal(new[] { "October" }, Labels(oslo));
        Assert.Equal(new[] { 2.5 }, Values(oslo));

        var utc = await GetAnalyticsAsync(user, "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z", "monthly", null);
        Assert.Equal(new[] { "2026-09", "2026-10" }, Keys(utc));
        Assert.Equal(new[] { "September", "October" }, Labels(utc));

        var templateTotal = Assert.Single(oslo.GetProperty("timePerTemplate").EnumerateArray());
        Assert.Equal("Deep work", templateTotal.GetProperty("templateTitle").GetString());
        Assert.Equal("#3366FF", templateTotal.GetProperty("categoryColor").GetString());
        Assert.Equal(1.5, templateTotal.GetProperty("totalHours").GetDouble());
    }

    [Fact]
    public async Task Years_are_taken_in_the_client_time_zone()
    {
        var user = await _fixture.CreateUserAsync();
        await CreateTaskAsync(user, "2025-12-31T23:30:00.000Z", 0.5); // 2026-01-01 00:30 in Oslo

        Assert.Equal(new[] { 2026 }, await GetYearsAsync(user, "Europe/Oslo"));
        Assert.Equal(new[] { 2025 }, await GetYearsAsync(user, null));
        Assert.Equal(new[] { 2025 }, await GetYearsAsync(user, "America/New_York"));

        var empty = await _fixture.CreateUserAsync();
        var kiritimatiNow = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Pacific/Kiritimati"));
        Assert.Equal(new[] { kiritimatiNow.Year }, await GetYearsAsync(empty, "Pacific/Kiritimati"));
    }

    [Fact]
    public async Task Entities_are_materialized_with_utc_kind_including_nullable_and_identity_columns()
    {
        var user = await _fixture.CreateUserAsync(); // login sets User.RefreshTokenExpiryTime
        var created = await CreateTaskAsync(user, "2026-10-08T07:00:00.000Z", 1);
        var id = created.GetProperty("id").GetGuid();

        var update = await user.Client.PutAsJsonAsync($"/api/tasks/{id}", new
        {
            title = "renamed",
            start = "2026-10-08T07:00:00.000Z",
            duration = 1,
            categoryId = user.CategoryId
        });
        Assert.Equal(HttpStatusCode.NoContent, update.StatusCode);

        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var task = await db.Tasks.AsNoTracking().SingleAsync(t => t.Id == id);
        Assert.Equal(DateTimeKind.Utc, task.Start.Kind);
        Assert.Equal(new DateTime(2026, 10, 8, 7, 0, 0, DateTimeKind.Utc), task.Start);
        Assert.Equal(DateTimeKind.Utc, task.CreatedOnUtc.Kind);
        Assert.NotNull(task.UpdatedOnUtc);
        Assert.Equal(DateTimeKind.Utc, task.UpdatedOnUtc!.Value.Kind);
        Assert.Null(task.DeletedOnUtc);

        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
        var entity = await userManager.FindByIdAsync(user.Id.ToString());
        Assert.NotNull(entity);
        Assert.Equal(DateTimeKind.Utc, entity!.RefreshTokenExpiryTime.Kind);
        Assert.True(entity.RefreshTokenExpiryTime > DateTime.UtcNow.AddDays(6));
    }

    [Fact]
    public void Utc_json_converter_is_registered_for_mvc_and_signalr()
    {
        var services = _fixture.Factory.Services;

        var mvc = services.GetRequiredService<IOptions<JsonOptions>>().Value.JsonSerializerOptions;
        Assert.Contains(mvc.Converters, c => c is UtcDateTimeJsonConverter);

        var signalR = services.GetRequiredService<IOptions<JsonHubProtocolOptions>>().Value.PayloadSerializerOptions;
        Assert.Contains(signalR.Converters, c => c is UtcDateTimeJsonConverter);
    }

    [Fact]
    public async Task Overlap_query_executes_on_sql_server_with_second_precision()
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var start = new DateTime(2026, 10, 7, 10, 0, 0, DateTimeKind.Utc);
        var query = db.Tasks.Where(t => t.UserId == Guid.Empty)
            .Where(Features.Commands.Tasks.TaskOverlap.Overlaps(start, start.AddMinutes(30)));

        var sql = query.ToQueryString();
        _output.WriteLine(sql);

        // AddHours would be DATEADD(hour, CAST(Duration AS int), ...), which truncates 1.5h to 1h and 0.25h to 0h.
        Assert.Contains("DATEADD(second, CAST(ROUND([t].[Duration] * 3600.0E0, 0) AS int), [t].[Start])", sql);
        Assert.DoesNotContain("DATEADD(hour", sql);
        Assert.False(await query.AnyAsync());
    }

    private async Task<string> ReadRawStartAsync(Guid id)
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        return await db.Database
            .SqlQuery<string>($"SELECT CONVERT(varchar(27), [Start], 121) AS [Value] FROM [Tasks] WHERE [Id] = {id}")
            .SingleAsync();
    }

    private static async Task<HttpResponseMessage> PostTaskAsync(TestUser user, string start, double duration, string title = "Task") =>
        await user.Client.PostAsJsonAsync("/api/tasks", new { title, start, duration, categoryId = user.CategoryId });

    private static async Task<JsonElement> CreateTaskAsync(TestUser user, string start, double duration, string title = "Task")
    {
        var response = await PostTaskAsync(user, start, duration, title);
        var content = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Created, $"{(int)response.StatusCode}: {content}");
        using var body = JsonDocument.Parse(content);
        return body.RootElement.Clone();
    }

    private static async Task<List<JsonElement>> GetTasksAsync(TestUser user, string startDate, string endDate)
    {
        var url = $"/api/tasks?startDate={Uri.EscapeDataString(startDate)}&endDate={Uri.EscapeDataString(endDate)}";
        var response = await user.Client.GetAsync(url);
        var content = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"{(int)response.StatusCode}: {content}");
        using var body = JsonDocument.Parse(content);
        return body.RootElement.EnumerateArray().Select(e => e.Clone()).ToList();
    }

    private static async Task<JsonElement> GetAnalyticsAsync(
        TestUser user, string startDate, string endDate, string viewType, string? timeZone)
    {
        var url = $"/api/tasks/analytics?startDate={Uri.EscapeDataString(startDate)}" +
                  $"&endDate={Uri.EscapeDataString(endDate)}&viewType={viewType}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (timeZone is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Time-Zone", timeZone);
        }

        var response = await user.Client.SendAsync(request);
        var content = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"{(int)response.StatusCode}: {content}");
        using var body = JsonDocument.Parse(content);
        return body.RootElement.Clone();
    }

    private static async Task<int[]> GetYearsAsync(TestUser user, string? timeZone)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/tasks/years");
        if (timeZone is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Time-Zone", timeZone);
        }

        var response = await user.Client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<int[]>())!;
    }

    private static async Task AssertConflictAsync(HttpResponseMessage response, string expectedMessage)
    {
        var content = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.Conflict, $"{(int)response.StatusCode}: {content}");
        using var body = JsonDocument.Parse(content);
        // The frontend shows error.response.data.message in its toast.
        Assert.Equal(expectedMessage, body.RootElement.GetProperty("message").GetString());
    }

    private static string?[] Keys(JsonElement analytics) =>
        analytics.GetProperty("breakdownData").EnumerateArray().Select(p => p.GetProperty("key").GetString()).ToArray();

    private static string?[] Labels(JsonElement analytics) =>
        analytics.GetProperty("breakdownData").EnumerateArray().Select(p => p.GetProperty("label").GetString()).ToArray();

    private static double[] Values(JsonElement analytics) =>
        analytics.GetProperty("breakdownData").EnumerateArray().Select(p => p.GetProperty("value").GetDouble()).ToArray();
}
