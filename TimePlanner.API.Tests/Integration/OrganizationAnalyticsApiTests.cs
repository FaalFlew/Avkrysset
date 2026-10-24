using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Tests.Integration;

/// <summary>
/// Organization analytics (docs/plans/organizations-phase3.md §2.7): the selection is resolved and bucketed in the
/// ORGANIZATION's zone whatever X-Time-Zone the caller sends; buckets are zero-filled; task-hours vs person-hours.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class OrganizationAnalyticsApiTests
{
    private const string CallerZone = "Asia/Tokyo";
    private readonly ApiFixture _fixture;

    public OrganizationAnalyticsApiTests(ApiFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Days_are_the_organizations_days_including_the_25_hour_DST_end_day()
    {
        var org = await OrgTestKit.CreateAsync(_fixture, "America/New_York");
        // 2026-11-01 is the US DST end (02:00 EDT -> 01:00 EST at 06:00Z); New York's Nov 1 is [04:00Z, 05:00Z next day).
        await AddTask("2026-11-01T03:30:00.000Z", 1);  // Oct 31 23:30 EDT (Nov 1 in UTC and Tokyo)
        await AddTask("2026-11-01T04:30:00.000Z", 2);  // Nov 1 00:30 EDT
        await AddTask("2026-11-02T04:30:00.000Z", 4);  // Nov 1 23:30 EST (Nov 2 in UTC and Tokyo: outside W44 there)
        await AddTask("2026-11-02T05:30:00.000Z", 8);  // Nov 2 00:30 EST = W45

        var daily = await AnalyticsAsync(org.Admin, org.OrgId, "view=daily&year=2026&from=44&to=44");

        Assert.Equal("America/New_York", daily.GetProperty("timeZoneId").GetString());
        Assert.Equal("America/New_York (UTC-05:00/-04:00)", daily.GetProperty("timeZoneLabel").GetString());
        Assert.Equal("daily", daily.GetProperty("view").GetString());
        Assert.Equal("2026-10-26T04:00:00.000Z", daily.GetProperty("rangeStartUtc").GetString());
        Assert.Equal("2026-11-02T05:00:00.000Z", daily.GetProperty("rangeEndUtc").GetString());
        Assert.Equal(new[] { "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01" }, Keys(daily));
        Assert.Equal(new[] { 0d, 0, 0, 0, 0, 1, 6 }, Values(daily));
        Assert.Equal("Sunday", daily.GetProperty("breakdownData")[6].GetProperty("label").GetString());
        Assert.Equal((7d, 3), (daily.GetProperty("totalHours").GetDouble(), daily.GetProperty("taskCount").GetInt32()));

        var weekly = await AnalyticsAsync(org.Owner, org.OrgId, "view=weekly&year=2026&from=44&to=45");
        Assert.Equal(new[] { "2026-W44", "2026-W45" }, Keys(weekly));
        Assert.Equal(new[] { 7d, 8 }, Values(weekly));

        Task<Guid> AddTask(string start, double hours) =>
            OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, $"Task {start}", start, hours, org.Member);
    }

    [Fact]
    public async Task Iso_week_53_and_a_zero_filled_year_of_months()
    {
        var org = await OrgTestKit.CreateAsync(_fixture, "America/New_York");
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "New year", "2027-01-02T12:00:00.000Z", 3, org.Admin); // 2026-W53
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Spring", "2026-03-15T12:00:00.000Z", 2, org.Admin);

        var w53 = await AnalyticsAsync(org.Owner, org.OrgId, "view=weekly&year=2026&from=52&to=53");
        Assert.Equal(new[] { "2026-W52", "2026-W53" }, Keys(w53));
        Assert.Equal(new[] { 0d, 3 }, Values(w53));

        var days = await AnalyticsAsync(org.Owner, org.OrgId, "view=daily&year=2026&from=53&to=53");
        Assert.Equal(7, Keys(days).Length);
        Assert.Equal(("2026-12-28", "2027-01-03"), (Keys(days)[0], Keys(days)[6]));
        Assert.Equal(3, Values(days)[5]); // Saturday Jan 2

        var months = await AnalyticsAsync(org.Owner, org.OrgId, "view=monthly&year=2026&from=0&to=11");
        Assert.Equal(Enumerable.Range(1, 12).Select(m => $"2026-{m:D2}"), Keys(months));
        Assert.Equal(new[] { 0d, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0 }, Values(months));
        Assert.Equal("March", months.GetProperty("breakdownData")[2].GetProperty("label").GetString());

        // 2027 has 52 ISO weeks.
        var invalid = await org.Owner.Client.GetAsync($"/api/organizations/{org.OrgId}/analytics?view=weekly&year=2027&from=53&to=53");
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("from and to must be ISO weeks from 1 to 52 of 2027.", await OrgTestKit.ReadMessageAsync(invalid));
    }

    [Fact]
    public async Task Total_hours_count_each_task_once_and_assigned_hours_count_each_assignee()
    {
        var org = await OrgTestKit.CreateAsync(_fixture);
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Pairing", "2026-11-03T09:00:00.000Z", 2, org.Member, org.Admin);
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Solo", "2026-11-04T09:00:00.000Z", 1, org.Member);
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Owner", "2026-11-05T09:00:00.000Z", 0.5, org.Owner);
        Assert.Equal(HttpStatusCode.NoContent, (await org.Member.Client.PostAsync($"/api/organizations/{org.OrgId}/members/me/leave", null)).StatusCode);

        var week = await AnalyticsAsync(org.Owner, org.OrgId, "view=weekly&year=2026&from=45&to=45");

        Assert.Equal(3.5, week.GetProperty("totalHours").GetDouble());
        Assert.Equal(5.5, week.GetProperty("assignedHours").GetDouble());
        Assert.Equal(3, week.GetProperty("taskCount").GetInt32());
        var members = week.GetProperty("timePerMember").EnumerateArray()
            .Select(m => (m.GetProperty("memberId").GetGuid(), m.GetProperty("memberStatus").GetString()!, m.GetProperty("totalHours").GetDouble()))
            .ToArray();
        Assert.Equal(new[] { (org.Member.Id, "Left", 3d), (org.Admin.Id, "Active", 2d), (org.Owner.Id, "Active", 0.5) }, members);
        var category = Assert.Single(week.GetProperty("timePerCategory").EnumerateArray());
        Assert.Equal(("Work", "#3366FF", 3.5), (category.GetProperty("categoryName").GetString(), category.GetProperty("categoryColor").GetString(),
            category.GetProperty("totalHours").GetDouble()));
    }

    [Fact]
    public async Task Member_analytics_cover_the_members_tasks_and_former_members()
    {
        var org = await OrgTestKit.CreateAsync(_fixture, "America/New_York");
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Mine", "2026-11-01T04:30:00.000Z", 2, org.Member, org.Admin);
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Not mine", "2026-10-30T12:00:00.000Z", 5, org.Admin);
        var url = $"/api/organizations/{org.OrgId}/analytics/members/{org.Member.Id}?view=daily&year=2026&from=44&to=44";

        var mine = await OrgTestKit.ReadJsonAsync(await GetAsync(org.Member, url), HttpStatusCode.OK);
        Assert.Equal((org.Member.Id, org.Member.Email, org.Member.Email, "Active"),
            (mine.GetProperty("memberId").GetGuid(), mine.GetProperty("displayName").GetString(), mine.GetProperty("memberEmail").GetString(),
             mine.GetProperty("memberStatus").GetString()));
        Assert.Equal((2d, 1), (mine.GetProperty("totalHours").GetDouble(), mine.GetProperty("taskCount").GetInt32()));
        Assert.Equal(new[] { 0d, 0, 0, 0, 0, 0, 2 }, Values(mine));
        Assert.Equal("America/New_York", mine.GetProperty("timeZoneId").GetString());
        Assert.False(mine.TryGetProperty("timePerMember", out _));

        Assert.Equal(HttpStatusCode.NoContent, (await org.Member.Client.PostAsync($"/api/organizations/{org.OrgId}/members/me/leave", null)).StatusCode);
        var former = await OrgTestKit.ReadJsonAsync(await GetAsync(org.Admin, url), HttpStatusCode.OK);
        Assert.Equal(("Left", 2d), (former.GetProperty("memberStatus").GetString(), former.GetProperty("totalHours").GetDouble()));

        var never = await GetAsync(org.Admin, $"/api/organizations/{org.OrgId}/analytics/members/{org.Outsider.Id}?view=daily&year=2026&from=44&to=44");
        Assert.Equal(HttpStatusCode.NotFound, never.StatusCode);
    }

    [Fact]
    public async Task Years_are_the_organizations_calendar_years()
    {
        var org = await OrgTestKit.CreateAsync(_fixture, "America/New_York");
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "New Year's Eve", "2027-01-01T03:00:00.000Z", 1, org.Admin); // Dec 31 in New York
        await OrgTestKit.CreateOrgTaskAsync(org.Owner, org.OrgId, "Old", "2025-06-01T12:00:00.000Z", 1, org.Admin);
        var url = $"/api/organizations/{org.OrgId}/analytics/years";

        var admin = await OrgTestKit.ReadJsonAsync(await GetAsync(org.Admin, url), HttpStatusCode.OK);
        Assert.Equal(new[] { 2026, 2025 }, admin.EnumerateArray().Select(y => y.GetInt32()));

        // A member only counts tasks assigned to them; with none it's the current year in the organization's zone.
        var member = await OrgTestKit.ReadJsonAsync(await GetAsync(org.Member, url), HttpStatusCode.OK);
        var newYork = TimeZoneResolver.ResolveOrUtc("America/New_York");
        Assert.Equal(new[] { TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, newYork).Year }, member.EnumerateArray().Select(y => y.GetInt32()));
    }

    [Theory]
    [InlineData("view=yearly&year=2026&from=0&to=0", "view must be 'monthly', 'weekly' or 'daily'.")]
    [InlineData("view=daily&year=2026&from=44&to=45", "For the daily view, from and to must be the same week.")]
    [InlineData("view=monthly&year=2026&from=0&to=12", "For the monthly view, from and to are month indexes from 0 (January) to 11 (December).")]
    [InlineData("startDate=2026-10-19T00:00:00.000Z&endDate=2026-10-26T00:00:00.000Z", "view must be 'monthly', 'weekly' or 'daily'. year is required. from is required. to is required.")]
    public async Task Invalid_selections_are_400(string query, string message)
    {
        var org = await OrgTestKit.CreateAsync(_fixture);

        foreach (var url in new[]
                 {
                     $"/api/organizations/{org.OrgId}/analytics?{query}",
                     $"/api/organizations/{org.OrgId}/analytics/members/{org.Member.Id}?{query}"
                 })
        {
            var response = await org.Owner.Client.GetAsync(url);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(message, await OrgTestKit.ReadMessageAsync(response));
        }
    }

    // --- Helpers ---

    private static async Task<HttpResponseMessage> GetAsync(TestUser user, string url)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("X-Time-Zone", CallerZone); // must not matter
        return await user.Client.SendAsync(request);
    }

    private static async Task<JsonElement> AnalyticsAsync(TestUser user, Guid orgId, string selection) =>
        await OrgTestKit.ReadJsonAsync(await GetAsync(user, $"/api/organizations/{orgId}/analytics?{selection}"), HttpStatusCode.OK);

    private static string[] Keys(JsonElement analytics) =>
        analytics.GetProperty("breakdownData").EnumerateArray().Select(p => p.GetProperty("key").GetString()!).ToArray();

    private static double[] Values(JsonElement analytics) =>
        analytics.GetProperty("breakdownData").EnumerateArray().Select(p => p.GetProperty("value").GetDouble()).ToArray();
}
