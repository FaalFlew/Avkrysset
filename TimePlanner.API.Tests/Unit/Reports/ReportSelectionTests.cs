using System.Globalization;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Features.Reports;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Tests.Unit.Reports;

public sealed class ReportSelectionTests
{
    private static TimeZoneInfo Zone(string id) =>
        TimeZoneResolver.TryResolve(id, out var zone) ? zone : throw new InvalidOperationException(id);

    private static DateTime Utc(string value) =>
        DateTime.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);

    [Theory]
    [InlineData("monthly", 2026, 0, 11)]
    [InlineData("MONTHLY", 2026, 9, 9)]
    [InlineData("weekly", 2026, 1, 53)]
    [InlineData("weekly", 2025, 52, 52)]
    [InlineData("daily", 2026, 53, 53)]
    public void Valid_selections_are_accepted(string view, int year, int from, int to)
    {
        var selection = ReportSelection.TryCreate(view, year, from, to, out var errors);

        Assert.Empty(errors);
        Assert.NotNull(selection);
        Assert.Equal(view.ToLowerInvariant(), selection.View);
    }

    [Theory]
    [InlineData(null, 2026, 1, 1, "view must be 'monthly', 'weekly' or 'daily'.")]
    [InlineData("yearly", 2026, 1, 1, "view must be 'monthly', 'weekly' or 'daily'.")]
    [InlineData("weekly", null, 1, 1, "year is required.")]
    [InlineData("weekly", 1800, 1, 1, "year must be between 1900 and 2200.")]
    [InlineData("weekly", 2026, null, 1, "from is required.")]
    [InlineData("weekly", 2026, 1, null, "to is required.")]
    [InlineData("monthly", 2026, 0, 12, "For the monthly view, from and to are month indexes from 0 (January) to 11 (December).")]
    [InlineData("monthly", 2026, -1, 3, "For the monthly view, from and to are month indexes from 0 (January) to 11 (December).")]
    [InlineData("monthly", 2026, 5, 2, "from must not be after to.")]
    [InlineData("weekly", 2026, 0, 3, "from and to must be ISO weeks from 1 to 53 of 2026.")]
    [InlineData("weekly", 2025, 1, 53, "from and to must be ISO weeks from 1 to 52 of 2025.")] // 2025 has 52 ISO weeks
    [InlineData("weekly", 2026, 41, 38, "from must not be after to.")]
    [InlineData("daily", 2026, 40, 41, "For the daily view, from and to must be the same week.")]
    public void Invalid_selections_are_explained(string? view, int? year, int? from, int? to, string expected)
    {
        var selection = ReportSelection.TryCreate(view, year, from, to, out var errors);

        Assert.Null(selection);
        Assert.Contains(expected, errors);
    }

    [Fact]
    public void Missing_values_are_all_reported_at_once()
    {
        ReportSelection.TryCreate(null, null, null, null, out var errors);

        Assert.Equal(4, errors.Count);
    }

    [Theory]
    // October 2026 in Oslo: CEST at the start, CET after 25 October.
    [InlineData("monthly", 2026, 9, 9, "Europe/Oslo", "2026-09-30T22:00:00Z", "2026-10-31T23:00:00Z")]
    [InlineData("monthly", 2026, 0, 11, "UTC", "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z")]
    [InlineData("monthly", 2026, 0, 11, "America/New_York", "2026-01-01T05:00:00Z", "2027-01-01T05:00:00Z")]
    // ISO weeks: 2026-W01 starts on Monday 2025-12-29, 2026-W53 ends on Sunday 2027-01-03.
    [InlineData("weekly", 2026, 1, 1, "UTC", "2025-12-29T00:00:00Z", "2026-01-05T00:00:00Z")]
    [InlineData("weekly", 2026, 53, 53, "UTC", "2026-12-28T00:00:00Z", "2027-01-04T00:00:00Z")]
    [InlineData("weekly", 2026, 38, 41, "Asia/Kathmandu", "2026-09-13T18:15:00Z", "2026-10-11T18:15:00Z")]
    [InlineData("daily", 2026, 40, 40, "Pacific/Kiritimati", "2026-09-27T10:00:00Z", "2026-10-04T10:00:00Z")]
    public void Selections_resolve_to_local_midnights(string view, int year, int from, int to, string zone, string start, string end)
    {
        var (startUtc, endUtc) = new ReportSelection(view, year, from, to).Resolve(Zone(zone));

        Assert.Equal(Utc(start), startUtc);
        Assert.Equal(Utc(end), endUtc);
        Assert.Equal(DateTimeKind.Utc, startUtc.Kind);
    }

    [Fact]
    public void Wall_clock_times_in_a_dst_gap_move_forward_and_repeated_times_take_the_first_occurrence()
    {
        var oslo = Zone("Europe/Oslo");

        // 2026-03-29 02:30 does not exist in Oslo (02:00 -> 03:00): it becomes 03:30 CEST = 01:30Z.
        Assert.Equal(Utc("2026-03-29T01:30:00Z"), ZonedTime.ToUtc(new DateTime(2026, 3, 29, 2, 30, 0), oslo));
        // 2026-10-25 02:30 happens twice: the first time is still CEST = 00:30Z.
        Assert.Equal(Utc("2026-10-25T00:30:00Z"), ZonedTime.ToUtc(new DateTime(2026, 10, 25, 2, 30, 0), oslo));
        Assert.Equal(Utc("2026-10-25T11:00:00Z"), ZonedTime.ToUtc(new DateTime(2026, 10, 25, 12, 0, 0), oslo));
    }

    [Fact]
    public void A_day_whose_midnight_is_skipped_starts_when_the_clock_jumps()
    {
        var zone = MidnightDstZone();

        // Clocks jump from 00:00 to 01:00 on 2026-09-06 (UTC-4 -> UTC-3): the day starts at 01:00 local = 04:00Z.
        Assert.Equal(Utc("2026-09-06T04:00:00Z"), ZonedTime.ToUtc(new DateTime(2026, 9, 6), zone));

        var buckets = TaskAnalyticsBreakdown.EnumerateBuckets(
            Utc("2026-09-05T04:00:00Z"), Utc("2026-09-08T03:00:00Z"), TaskAnalyticsBreakdown.Daily, zone);
        Assert.Equal(new[] { "2026-09-05", "2026-09-06", "2026-09-07" }, buckets.Select(b => b.Key));
        Assert.Equal(Utc("2026-09-06T04:00:00Z"), buckets[1].StartUtc);
        Assert.Equal(Utc("2026-09-07T03:00:00Z"), buckets[2].StartUtc);
    }

    [Fact]
    public void Buckets_cover_the_range_with_the_breakdown_keys()
    {
        var oslo = Zone("Europe/Oslo");
        var (start, end) = new ReportSelection("weekly", 2026, 52, 53).Resolve(oslo);

        var weeks = TaskAnalyticsBreakdown.EnumerateBuckets(start, end, "weekly", oslo);
        Assert.Equal(new[] { ("2026-W52", "Week 52"), ("2026-W53", "Week 53") }, weeks.Select(b => (b.Key, b.Label)));

        var (yearStart, yearEnd) = new ReportSelection("monthly", 2026, 0, 11).Resolve(oslo);
        var months = TaskAnalyticsBreakdown.EnumerateBuckets(yearStart, yearEnd, "monthly", oslo);
        Assert.Equal(12, months.Count);
        Assert.Equal("2026-01", months[0].Key);
        Assert.Equal("2026-12", months[^1].Key);
        Assert.Equal(Utc("2026-03-31T22:00:00Z"), months[3].StartUtc); // April starts on CEST

        Assert.Empty(TaskAnalyticsBreakdown.EnumerateBuckets(end, start, "weekly", oslo));
        Assert.Empty(TaskAnalyticsBreakdown.EnumerateBuckets(start, end, "yearly", oslo));
    }

    // A zone whose DST starts at midnight (like Santiago, Havana or Beirut), defined here so the test does not
    // depend on the OS time zone database.
    private static TimeZoneInfo MidnightDstZone()
    {
        var rule = TimeZoneInfo.AdjustmentRule.CreateAdjustmentRule(
            new DateTime(2020, 1, 1), new DateTime(2030, 12, 31), TimeSpan.FromHours(1),
            TimeZoneInfo.TransitionTime.CreateFloatingDateRule(new DateTime(1, 1, 1, 0, 0, 0), 9, 1, DayOfWeek.Sunday),
            TimeZoneInfo.TransitionTime.CreateFloatingDateRule(new DateTime(1, 1, 1, 0, 0, 0), 4, 1, DayOfWeek.Sunday));
        return TimeZoneInfo.CreateCustomTimeZone("Test/MidnightDst", TimeSpan.FromHours(-4), "Midnight DST", "Standard",
            "Daylight", new[] { rule });
    }
}
