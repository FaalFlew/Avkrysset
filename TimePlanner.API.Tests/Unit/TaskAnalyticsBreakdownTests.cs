using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Tests.Unit;

public sealed class TaskAnalyticsBreakdownTests
{
    private static readonly Guid Work = Guid.NewGuid();
    private static readonly Guid Gym = Guid.NewGuid();

    private static TimeZoneInfo Zone(string id) =>
        TimeZoneResolver.TryResolve(id, out var zone) ? zone : throw new InvalidOperationException(id);

    private static AnalyticsTaskRow Row(string utc, double hours = 1, Guid? category = null, string color = "#111111") =>
        new(DateTime.Parse(utc, null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal),
            hours, category ?? Work, "Work", color, null);

    [Theory]
    // Monday 00:30 in Oslo is still Sunday in UTC.
    [InlineData("Europe/Oslo", "2026-10-04T22:30:00Z", "2026-10-05", "Monday")]
    [InlineData("UTC", "2026-10-04T22:30:00Z", "2026-10-04", "Sunday")]
    // UTC+14: already the next day.
    [InlineData("Pacific/Kiritimati", "2026-10-04T10:30:00Z", "2026-10-05", "Monday")]
    // UTC-11: still the previous day.
    [InlineData("Pacific/Pago_Pago", "2026-10-05T10:30:00Z", "2026-10-04", "Sunday")]
    // UTC+13:45: 09:00 local on 2026-10-03 is 2026-10-02T19:15Z.
    [InlineData("Pacific/Chatham", "2026-10-02T19:15:00Z", "2026-10-03", "Saturday")]
    public void Daily_buckets_use_the_local_date(string zone, string startUtc, string expectedKey, string expectedLabel)
    {
        var point = Assert.Single(TaskAnalyticsBreakdown.Build(new[] { Row(startUtc) }, "daily", Zone(zone)));

        Assert.Equal(expectedKey, point.Key);
        Assert.Equal(expectedLabel, point.Label);
    }

    [Theory]
    [InlineData("Europe/Oslo", "2026-09-30T22:30:00Z", "2026-10", "October")]
    [InlineData("UTC", "2026-09-30T22:30:00Z", "2026-09", "September")]
    [InlineData("America/New_York", "2026-01-01T03:00:00Z", "2025-12", "December")]
    public void Monthly_buckets_use_the_local_month(string zone, string startUtc, string expectedKey, string expectedLabel)
    {
        var point = Assert.Single(TaskAnalyticsBreakdown.Build(new[] { Row(startUtc) }, "MONTHLY", Zone(zone)));

        Assert.Equal(expectedKey, point.Key);
        Assert.Equal(expectedLabel, point.Label);
    }

    [Theory]
    [InlineData("Europe/Oslo", "2026-10-04T22:30:00Z", "2026-W41", "Week 41")]
    [InlineData("UTC", "2026-10-04T22:30:00Z", "2026-W40", "Week 40")]
    // ISO week-years differ from calendar years around New Year.
    [InlineData("UTC", "2027-01-01T12:00:00Z", "2026-W53", "Week 53")]
    [InlineData("UTC", "2025-12-29T12:00:00Z", "2026-W01", "Week 1")]
    [InlineData("Europe/Oslo", "2026-12-31T23:30:00Z", "2026-W53", "Week 53")] // Fri 2027-01-01 00:30 local
    [InlineData("Europe/Oslo", "2027-01-03T23:30:00Z", "2027-W01", "Week 1")]  // Mon 2027-01-04 00:30 local
    public void Weekly_buckets_use_the_local_iso_week(string zone, string startUtc, string expectedKey, string expectedLabel)
    {
        var point = Assert.Single(TaskAnalyticsBreakdown.Build(new[] { Row(startUtc) }, "weekly", Zone(zone)));

        Assert.Equal(expectedKey, point.Key);
        Assert.Equal(expectedLabel, point.Label);
    }

    [Fact]
    public void Buckets_are_chronological_summed_and_colored_by_the_dominant_category()
    {
        var tasks = new[]
        {
            Row("2026-10-11T10:00:00Z", 1, Gym, "#00FF00"),   // Sunday
            Row("2026-10-05T08:00:00Z", 1, Work, "#0000FF"),  // Monday
            Row("2026-10-05T10:00:00Z", 2, Gym, "#00FF00"),   // Monday
            Row("2026-10-07T10:00:00Z", 0.5, Work, "#0000FF") // Wednesday
        };

        var points = TaskAnalyticsBreakdown.Build(tasks, "daily", TimeZoneInfo.Utc);

        Assert.Equal(new[] { "2026-10-05", "2026-10-07", "2026-10-11" }, points.Select(p => p.Key));
        Assert.Equal(new[] { "Monday", "Wednesday", "Sunday" }, points.Select(p => p.Label));
        Assert.Equal(new[] { 3d, 0.5d, 1d }, points.Select(p => p.Value));
        Assert.Equal(new[] { "#00FF00", "#0000FF", "#00FF00" }, points.Select(p => p.DominantCategoryColor));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("yearly")]
    public void Unknown_view_types_produce_no_breakdown(string? viewType)
    {
        Assert.Empty(TaskAnalyticsBreakdown.Build(new[] { Row("2026-10-05T08:00:00Z") }, viewType, TimeZoneInfo.Utc));
        Assert.False(TaskAnalyticsBreakdown.IsSupportedViewType(viewType));
    }

    [Theory]
    [InlineData("Europe/Oslo", 2026)]
    [InlineData("UTC", 2025)]
    [InlineData("America/New_York", 2025)]
    public void Years_are_taken_in_the_local_calendar(string zone, int expectedYear)
    {
        var start = new DateTime(2025, 12, 31, 23, 30, 0, DateTimeKind.Utc);

        Assert.Equal(new[] { expectedYear }, TaskYears.LocalYears(new[] { start }, Zone(zone)));
    }

    [Fact]
    public void Years_are_distinct_and_newest_first()
    {
        var starts = new[]
        {
            new DateTime(2024, 6, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2024, 7, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2025, 12, 31, 23, 30, 0, DateTimeKind.Utc)
        };

        Assert.Equal(new[] { 2026, 2024 }, TaskYears.LocalYears(starts, Zone("Europe/Oslo")));
    }
}
