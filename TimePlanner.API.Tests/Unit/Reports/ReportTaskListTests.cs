using System.Globalization;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Features.Reports;
using TimePlanner.API.Utilities;
using static TimePlanner.API.Tests.Unit.Reports.ReportTestData;

namespace TimePlanner.API.Tests.Unit.Reports;

/// <summary>
/// The report's task list (docs/plans/analytics-task-list.md): rows, order, day grouping, "+1d" markers and totals.
/// Which tasks are in scope (assigned to others / organizations left) is decided by the database query and covered by
/// the LocalDB tests in Integration/ReportsApiTests.cs.
/// </summary>
public sealed class ReportTaskListTests
{
    private const string Weekly = TaskAnalyticsBreakdown.Weekly;
    private const string Daily = TaskAnalyticsBreakdown.Daily;
    private static readonly TimeZoneInfo Oslo = TimeZoneResolver.ResolveOrUtc("Europe/Oslo");

    [Fact]
    public void Rows_carry_the_task_fields_and_resolve_templates_like_the_template_table()
    {
        var org = Guid.Parse("55555555-5555-5555-5555-555555555555");
        var templates = new Dictionary<Guid, AnalyticsTemplate> { [Standup] = new("Standup", "Work", "#2F7FE0") };
        var model = Build(Request(Weekly, 2026, 40, 40, "Europe/Oslo"), new[]
        {
            PlannerTask("Daily standup", "2026-09-28T07:00:00Z", 0.25, template: Standup, createdOnUtc: "2026-09-20T18:00:00Z"),
            PlannerTask("Old routine", "2026-09-29T07:00:00Z", 1, template: DeletedTemplateId),
            PlannerTask("Gym", "2026-09-30T16:00:00Z", 1, category: Gym, name: "Gym", color: "#0E9C8C"),
            PlannerTask("Warehouse shift", "2026-10-01T06:00:00Z", 8, organizationId: org, organizationName: "Acme AS",
                createdBy: "Grace Hopper", createdById: Guid.Parse("99999999-0000-0000-0000-000000000001"),
                assignees: new[] { "Ada Lovelace", "Bob Builder" }),
            PlannerTask("Next week", "2026-10-05T07:00:00Z", 1), // outside the selection
            PlannerTask("Last week", "2026-09-27T21:59:00Z", 1)  // Sunday 23:59 in Oslo: outside
        }, templates);

        Assert.Equal(new[] { "Daily standup", "Old routine", "Gym", "Warehouse shift" }, model.Tasks.Select(t => t.Title));

        var standup = model.Tasks[0];
        Assert.Equal(new DateTime(2026, 9, 28, 7, 0, 0, DateTimeKind.Utc), standup.StartUtc);
        Assert.Equal(new DateTime(2026, 9, 28, 7, 15, 0, DateTimeKind.Utc), standup.EndUtc);
        Assert.Equal(DateTimeKind.Utc, standup.EndUtc.Kind);
        Assert.Equal((0.25, "Work", "#2F7FE0", "Standup", (string?)null), (standup.DurationHours, standup.CategoryName, standup.CategoryColor, standup.TemplateTitle, standup.OrganizationName));
        Assert.Equal((Ada, AdaId, new DateTime(2026, 9, 20, 18, 0, 0, DateTimeKind.Utc)), (standup.CreatedByDisplayName, standup.CreatedByUserId, standup.CreatedOnUtc));
        Assert.Empty(standup.AssigneeNames);

        Assert.Equal(ReportModelBuilder.DeletedTemplate, model.Tasks[1].TemplateTitle);
        Assert.Null(model.Tasks[2].TemplateTitle);
        Assert.Equal(("Gym", "#0E9C8C"), (model.Tasks[2].CategoryName, model.Tasks[2].CategoryColor));

        // Organization tasks: the organization's name and palette color, exactly as in the category breakdown.
        var shift = model.Tasks[3];
        Assert.Equal(("Acme AS", OrganizationPalette.ColorFor(org), "Acme AS"), (shift.CategoryName, shift.CategoryColor, shift.OrganizationName));
        Assert.Contains(model.Categories, c => (c.Name, c.Color) == (shift.CategoryName, shift.CategoryColor));
        Assert.Null(shift.TemplateTitle);
        Assert.Equal("Grace Hopper", shift.CreatedByDisplayName);
        Assert.Equal(new[] { "Ada Lovelace", "Bob Builder" }, shift.AssigneeNames);
    }

    [Fact]
    public void Rows_are_ordered_by_start_then_ordinal_title_then_ordinal_id()
    {
        var a = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000000");
        var b = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000000");
        var zero = Guid.Parse("0aaaaaaa-0000-0000-0000-000000000000");
        const string nine = "2026-09-28T07:00:00Z";

        var model = Build(Request(Daily, 2026, 40, 40), new[]
        {
            PlannerTask("later", "2026-09-28T08:00:00Z", 1),
            PlannerTask("b", nine, 1, id: a),
            PlannerTask("a", nine, 1, id: b),
            PlannerTask("a", nine, 1, id: a),
            PlannerTask("B", nine, 1, id: b),
            PlannerTask("a", nine, 1, id: zero),
            PlannerTask("earlier", "2026-09-28T06:59:59Z", 1)
        });

        // Ordinal: upper case before lower case (JavaScript's <); ids compared as lower-case strings.
        Assert.Equal(
            new[] { ("earlier", (Guid?)null), ("B", b), ("a", zero), ("a", a), ("a", b), ("b", a), ("later", null) },
            model.Tasks.Select(t => (t.Title, t.Title is "earlier" or "later" ? (Guid?)null : t.Id)));
    }

    [Fact]
    public void The_task_list_totals_equal_the_kpis_exactly()
    {
        // 0.1 + 0.2 + … is not exact in floating point: the list and the KPIs must still agree to the last bit.
        var monday = Utc("2026-09-28T06:00:00Z");
        var tasks = Enumerable.Range(0, 40)
            .Select(i => PlannerTask($"Task {i:D2}", monday.AddDays(i % 6).AddHours(i % 9).ToString("O"), 0.1 * (1 + i % 3)))
            .ToList();
        var model = Build(Request(Daily, 2026, 40, 40, "Europe/Oslo"), tasks);

        Assert.Equal(40, model.Kpis.TaskCount);
        Assert.Equal(model.Kpis.TaskCount, model.Tasks.Count);
        Assert.Equal(model.Kpis.TotalHours, model.Tasks.Sum(t => t.DurationHours));

        var days = ReportTaskList.Days(model.Tasks, model.TimeZone);
        Assert.Equal(model.Kpis.ActiveDays, days.Count);
        Assert.Equal(model.Tasks, days.SelectMany(d => d.Tasks));
        Assert.Equal(model.Kpis.TotalHours, days.Sum(d => d.Hours), 9);
        Assert.Equal(model.Periods.Where(p => p.Hours > 0).Select(p => p.Hours), days.Select(d => d.Hours), new HoursComparer());
    }

    [Fact]
    public void Days_and_end_markers_follow_the_local_calendar_across_the_october_dst_change()
    {
        // Oslo, Sunday 2026-10-25 (end of week 43): clocks go back from 03:00 CEST to 02:00 CET (01:00Z).
        var model = Build(Request(Weekly, 2026, 43, 44, "Europe/Oslo"), new[]
        {
            PlannerTask("Before the change", "2026-10-24T23:30:00Z", 3),  // Sun 01:30 CEST → 03:30 CET (3 h elapsed)
            PlannerTask("Late Sunday", "2026-10-25T22:30:00Z", 1),         // Sun 23:30 CET → Mon 00:30: +1d
            PlannerTask("Monday early", "2026-10-25T23:30:00Z", 0.5),      // Mon 00:30 CET: week 44, though Sunday in UTC
            PlannerTask("Ends at midnight", "2026-10-26T22:00:00Z", 1),    // Mon 23:00 → Tue 00:00: same day
            PlannerTask("Two days", "2026-10-27T22:00:00Z", 26)            // Tue 23:00 → Thu 01:00: +2d
        });

        var days = ReportTaskList.Days(model.Tasks, model.TimeZone);
        Assert.Equal(
            new[]
            {
                (new DateTime(2026, 10, 25), new[] { "Before the change", "Late Sunday" }, 4d),
                (new DateTime(2026, 10, 26), new[] { "Monday early", "Ends at midnight" }, 1.5),
                (new DateTime(2026, 10, 27), new[] { "Two days" }, 26d)
            },
            days.Select(d => (d.Day, d.Tasks.Select(t => t.Title).ToArray(), d.Hours)));
        Assert.Equal(3, model.Kpis.ActiveDays);

        string Span(string title)
        {
            var task = model.Tasks.Single(t => t.Title == title);
            var marker = ReportTaskList.EndDayMarker(task, Oslo);
            return string.Create(CultureInfo.InvariantCulture,
                $"{ReportTaskList.LocalStart(task, Oslo):ddd HH:mm}-{ReportTaskList.LocalEnd(task, Oslo):ddd HH:mm}{marker}");
        }

        Assert.Equal("Sun 01:30-Sun 03:30", Span("Before the change"));
        Assert.Equal("Sun 23:30-Mon 00:30+1d", Span("Late Sunday"));
        Assert.Equal("Mon 00:30-Mon 01:00", Span("Monday early"));
        Assert.Equal("Mon 23:00-Tue 00:00", Span("Ends at midnight"));
        Assert.Equal("Tue 23:00-Thu 01:00+2d", Span("Two days"));

        // In UTC the early Monday task belongs to Sunday.
        var utc = Build(Request(Weekly, 2026, 43, 44, "UTC"), model.Tasks.Select(t => PlannerTask(t.Title, t.StartUtc.ToString("O"), t.DurationHours)));
        Assert.Equal(new DateTime(2026, 10, 25), ReportTaskList.LocalDay(utc.Tasks.Single(t => t.Title == "Monday early"), utc.TimeZone));
    }

    [Fact]
    public void Iso_week_53_includes_the_first_days_of_the_next_calendar_year()
    {
        var model = Build(Request(Weekly, 2026, 53, 53), new[]
        {
            PlannerTask("Sunday before", "2026-12-27T23:59:00Z", 1),
            PlannerTask("Monday", "2026-12-28T09:00:00Z", 1),
            PlannerTask("New Year's Day", "2027-01-01T10:00:00Z", 2),
            PlannerTask("Last day of W53", "2027-01-03T20:00:00Z", 1.5),
            PlannerTask("2027-W01", "2027-01-04T00:00:00Z", 1)
        });

        Assert.Equal(new[] { "Monday", "New Year's Day", "Last day of W53" }, model.Tasks.Select(t => t.Title));
        Assert.Equal(
            new[] { new DateTime(2026, 12, 28), new DateTime(2027, 1, 1), new DateTime(2027, 1, 3) },
            ReportTaskList.Days(model.Tasks, model.TimeZone).Select(d => d.Day));
        Assert.Equal(4.5, model.Kpis.TotalHours);
        Assert.Equal("time-planner-tasks-2026-W53.csv", ReportFileNames.For(model.Selection, ReportFormat.Csv, ReportFileNames.TasksPrefix));
    }

    [Theory]
    [InlineData("2026-10-05T21:00:00Z", 1, 0)]        // 23:00–00:00 in Oslo ends "today"
    [InlineData("2026-10-05T21:00:00Z", 1.25, 1)]     // → 00:15
    [InlineData("2026-10-05T06:00:00Z", 0, 0)]        // zero length
    [InlineData("2026-10-05T06:00:00Z", 24, 1)]       // 08:00 → 08:00 next day
    [InlineData("2026-10-05T06:00:00Z", 40, 1)]       // → 00:00 two days later: still +1d
    [InlineData("2026-10-05T06:00:00Z", 40.5, 2)]
    public void End_day_offsets_use_the_last_occupied_minute(string startUtc, double hours, int expected)
    {
        var task = Assert.Single(Build(Request(Daily, 2026, 41, 41, "Europe/Oslo"), new[] { PlannerTask("t", startUtc, hours) }).Tasks);

        Assert.Equal(expected, ReportTaskList.EndDayOffset(task, Oslo));
        Assert.Equal(expected == 0 ? "" : $"+{expected}d", ReportTaskList.EndDayMarker(task, Oslo));
    }

    [Theory]
    [InlineData(1 / 3d, 1_200_000)]
    [InlineData(0.1, 360_000)]
    [InlineData(2.5, 9_000_000)]
    [InlineData(1.0000001, 3_600_000)] // 3 600 000.36 ms → rounds down
    [InlineData(1.0000002, 3_600_001)] // 3 600 000.72 ms → rounds up
    [InlineData(double.NaN, 0)]
    public void Ends_are_start_plus_the_duration_rounded_to_the_millisecond(double hours, long milliseconds)
    {
        var start = new DateTime(2026, 10, 5, 8, 0, 0, DateTimeKind.Utc);

        var end = ReportTaskList.EndOf(start, hours);

        Assert.Equal(milliseconds, (long)(end - start).TotalMilliseconds);
        Assert.Equal(DateTimeKind.Utc, end.Kind);
    }

    [Theory]
    [InlineData(0, "0m", "0:00")]
    [InlineData(0.25, "15m", "0:15")]
    [InlineData(1, "1h", "1:00")]
    [InlineData(1.5, "1h 30m", "1:30")]
    [InlineData(1 / 3d, "20m", "0:20")]
    [InlineData(0.99999, "1h", "1:00")]
    [InlineData(25.75, "25h 45m", "25:45")]
    [InlineData(1234.5, "1234h 30m", "1234:30")]
    [InlineData(-1, "0m", "0:00")]
    public void Durations_are_rounded_to_whole_minutes(double hours, string compact, string clock)
    {
        Assert.Equal(compact, ReportFormatting.Duration(hours));
        Assert.Equal(clock, ReportFormatting.ClockDuration(hours));
    }

    private sealed class HoursComparer : IEqualityComparer<double>
    {
        public bool Equals(double x, double y) => Math.Abs(x - y) < 1e-9;
        public int GetHashCode(double obj) => 0;
    }
}
