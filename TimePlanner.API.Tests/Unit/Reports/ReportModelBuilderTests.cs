using System.Globalization;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Features.Reports;
using TimePlanner.API.Utilities;
using static TimePlanner.API.Tests.Unit.Reports.ReportTestData;

namespace TimePlanner.API.Tests.Unit.Reports;

public sealed class ReportModelBuilderTests
{
    private const string Monthly = TaskAnalyticsBreakdown.Monthly;
    private const string Weekly = TaskAnalyticsBreakdown.Weekly;
    private const string Daily = TaskAnalyticsBreakdown.Daily;

    [Fact]
    public void Periods_are_zero_filled_for_every_bucket_of_the_selection()
    {
        var model = Build(Request(Monthly, 2026, 0, 11), new[] { Row("2026-03-10T10:00:00Z", 2) });

        Assert.Equal(Enumerable.Range(1, 12).Select(m => $"2026-{m:D2}"), model.Periods.Select(p => p.Key));
        Assert.Equal(2, model.Periods.Single(p => p.Key == "2026-03").Hours);
        Assert.All(model.Periods.Where(p => p.Key != "2026-03"), p =>
        {
            Assert.Equal(0, p.Hours);
            Assert.Null(p.Color);
        });
        Assert.Equal(("March 2026", "Mar"), (model.Periods[2].Label, model.Periods[2].ShortLabel));
    }

    [Fact]
    public void A_year_of_iso_weeks_has_53_buckets_in_2026()
    {
        var model = Build(Request(Weekly, 2026, 1, 53), new[]
        {
            Row("2025-12-29T09:00:00Z", 1),   // Monday of 2026-W01
            Row("2027-01-03T20:00:00Z", 1.5)  // Sunday of 2026-W53
        });

        Assert.Equal(53, model.Periods.Count);
        Assert.Equal(("2026-W01", "Week 1", "W1"), (model.Periods[0].Key, model.Periods[0].Label, model.Periods[0].ShortLabel));
        Assert.Equal(("2026-W53", 1.5), (model.Periods[^1].Key, model.Periods[^1].Hours));
        Assert.Equal(1, model.Periods[0].Hours);
        Assert.Equal(new DateTime(2025, 12, 29, 0, 0, 0, DateTimeKind.Utc), model.RangeStartUtc);
        Assert.Equal(new DateTime(2027, 1, 4, 0, 0, 0, DateTimeKind.Utc), model.RangeEndUtc);
    }

    [Fact]
    public void Tasks_are_bucketed_in_the_requested_zone()
    {
        // Sunday 22:30 UTC is already Monday 00:30 in Oslo (week 41).
        var tasks = new[] { Row("2026-10-04T22:30:00Z", 1.5), Row("2026-10-05T10:00:00Z", 1) };

        var oslo = Build(Request(Daily, 2026, 41, 41, "Europe/Oslo"), tasks);
        Assert.Equal("2026-10-05", oslo.Periods[0].Key);
        Assert.Equal(2.5, oslo.Periods[0].Hours);
        Assert.Equal(2.5, oslo.Kpis.TotalHours);
        Assert.Equal(1, oslo.Kpis.ActiveDays);

        var utc = Build(Request(Daily, 2026, 41, 41, "UTC"), tasks);
        Assert.Equal(1, utc.Kpis.TotalHours); // the Sunday task belongs to week 40 in UTC
        Assert.Equal(1, utc.Periods[0].Hours);
    }

    [Fact]
    public void The_day_clocks_go_back_is_one_bucket_of_25_hours()
    {
        // Oslo, Sunday 2026-10-25 (week 43): 00:30 local is 22:30Z the day before, 23:30 local is 22:30Z the same day.
        var model = Build(Request(Daily, 2026, 43, 43, "Europe/Oslo"), new[]
        {
            Row("2026-10-24T22:30:00Z", 1),
            Row("2026-10-25T22:30:00Z", 2),
            Row("2026-10-25T23:30:00Z", 4) // Monday 26 00:30 local: next week
        });

        Assert.Equal(7, model.Periods.Count);
        Assert.Equal(("2026-10-25", 3d), (model.Periods[^1].Key, model.Periods[^1].Hours));
        Assert.Equal(3, model.Kpis.TotalHours);
        Assert.Equal(new DateTime(2026, 10, 18, 22, 0, 0, DateTimeKind.Utc), model.RangeStartUtc);
        Assert.Equal(new DateTime(2026, 10, 25, 23, 0, 0, DateTimeKind.Utc), model.RangeEndUtc);
        Assert.Equal("Europe/Oslo (UTC+01:00/+02:00)", model.TimeZoneLabel);
    }

    [Fact]
    public void Kpis_categories_and_templates_are_computed()
    {
        var org = Guid.Parse("55555555-5555-5555-5555-555555555555");
        var tasks = new[]
        {
            Row("2026-09-28T08:00:00Z", 2, template: Standup),
            Row("2026-09-28T12:00:00Z", 1, Gym, "Gym", "#0E9C8C"),
            Row("2026-09-30T08:00:00Z", 1, template: DeletedTemplateId),
            AnalyticsTaskRow.ForOrganizationTask(new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc), 4, org, "Acme"),
            Row("2026-10-05T08:00:00Z", 9) // next week: outside the selection, ignored
        };
        var templates = new Dictionary<Guid, AnalyticsTemplate> { [Standup] = new("Standup", "Work", "#2F7FE0") };

        var model = Build(Request(Weekly, 2026, 40, 40), tasks, templates);

        Assert.Equal(new ReportKpis(8, 4, 3, 8 / 3d, new ReportCategory("Acme", OrganizationPalette.ColorFor(org), 4, 0.5)), model.Kpis);
        Assert.Equal(new[] { ("Acme", 4d, 0.5), ("Work", 3d, 0.375), ("Gym", 1d, 0.125) },
            model.Categories.Select(c => (c.Name, c.Hours, c.Share)));
        Assert.Equal(new[]
        {
            new ReportTemplate("Standup", "Work", "#2F7FE0", 2, 0.25, false),
            new ReportTemplate(ReportModelBuilder.DeletedTemplate, null, null, 1, 0.125, false),
            new ReportTemplate(ReportModelBuilder.WithoutTemplate, null, null, 5, 0.625, true)
        }, model.Templates);
        Assert.Equal(OrganizationPalette.ColorFor(org), Assert.Single(model.Periods).Color); // dominant category of the week
    }

    [Fact]
    public void Equal_hours_are_ordered_by_ordinal_name_then_id_and_the_first_is_the_top_category()
    {
        var org = Guid.Parse("00000000-0000-0000-0000-00000000000a");
        var acme = Guid.Parse("bbbbbbbb-0000-0000-0000-000000000000");
        var zeta = Guid.Parse("cccccccc-0000-0000-0000-000000000000");
        var alpha = Guid.Parse("dddddddd-0000-0000-0000-000000000000");
        var templates = new Dictionary<Guid, AnalyticsTemplate>
        {
            [zeta] = new("Zeta", "Work", "#2F7FE0"),
            [alpha] = new("alpha", "Work", "#2F7FE0")
        };

        // Work = 0.1 + 0.1 + 0.1 h (0.30000000000000004 in floating point) ties with the 0.3 h categories.
        var tasks = new[]
        {
            Row("2026-12-28T08:00:00Z", 0.1, template: alpha),
            Row("2026-12-28T09:00:00Z", 0.1, template: zeta),
            Row("2026-12-28T10:00:00Z", 0.1),
            Row("2026-12-28T11:00:00Z", 0.3, acme, "Acme Ops", "#DA6A1C"),
            AnalyticsTaskRow.ForOrganizationTask(new DateTime(2026, 12, 29, 9, 0, 0, DateTimeKind.Utc), 0.3, org, "Acme Ops"),
            Row("2026-12-30T10:00:00Z", 0.25, Gym, "acme", "#0E9C8C"),
            Row("2026-12-30T11:00:00Z", 0.05, Gym, "acme", "#0E9C8C", template: DeletedTemplateId)
        };

        var model = Build(Request(Weekly, 2026, 53, 53), tasks, templates);

        // Ordinal: "Acme Ops" (same name: ids "0000…" < "bbbb…") < "Work" < "acme" (upper case sorts first).
        Assert.Equal(new[] { ("Acme Ops", OrganizationPalette.ColorFor(org)), ("Acme Ops", "#DA6A1C"), ("Work", "#2F7FE0"), ("acme", "#0E9C8C") },
            model.Categories.Select(c => (c.Name, c.Color)));
        Assert.Equal(OrganizationPalette.ColorFor(org), model.Kpis.TopCategory!.Color);
        Assert.Equal(new[] { "Zeta", "alpha", "Deleted template", "Without template" }, model.Templates.Select(t => t.Name));
        // The week's color is the top category's (same tie-break).
        Assert.Equal(OrganizationPalette.ColorFor(org), Assert.Single(model.Periods).Color);
    }

    [Fact]
    public void An_empty_range_still_has_every_period_and_the_without_template_row()
    {
        var model = Build(Request(Daily, 2026, 40, 40), Array.Empty<AnalyticsTaskRow>());

        Assert.Equal(new ReportKpis(0, 0, 0, 0, null), model.Kpis);
        Assert.Equal(7, model.Periods.Count);
        Assert.Empty(model.Categories);
        var row = Assert.Single(model.Templates);
        Assert.True(row.IsWithoutTemplate);
        Assert.Equal(0, row.Hours);
    }

    [Theory]
    [InlineData("en-US", null, PaperSize.Letter)]
    [InlineData("en", null, PaperSize.Letter)]
    [InlineData("fr-CA", null, PaperSize.Letter)]
    [InlineData("es-MX", null, PaperSize.Letter)]
    [InlineData("nb-NO", null, PaperSize.A4)]
    [InlineData("en-GB", null, PaperSize.A4)]
    [InlineData(null, null, PaperSize.A4)]
    [InlineData("not a locale!", null, PaperSize.A4)]
    [InlineData("en-US", PaperSize.A4, PaperSize.A4)]
    [InlineData("nb-NO", PaperSize.Letter, PaperSize.Letter)]
    public void Paper_comes_from_the_request_or_the_locale_region(string? locale, PaperSize? requested, PaperSize expected)
    {
        Assert.Equal(expected, Build(Request(Daily, 2026, 40, 40, locale: locale, paper: requested), Array.Empty<AnalyticsTaskRow>()).Paper);
    }

    [Theory]
    [InlineData("nb-NO", "nb-NO", "nb-NO")]
    [InlineData("en-US", "en-US", "en-US")]
    [InlineData("ar-EG", "ar-EG", "ar-EG")]
    [InlineData("xx-NOPE", "", "invariant")]
    [InlineData(null, "", "invariant")]
    // Thai month names have no glyphs in the report fonts: dates fall back to invariant, the CSV style keeps th-TH.
    [InlineData("th-TH", "", "th-TH")]
    // Saudi Arabia defaults to the Umm al-Qura calendar: reports format dates on the Gregorian calendar instead.
    [InlineData("ar-SA", "ar-SA", "ar-SA")]
    public void Cultures_resolve_with_fallbacks(string? locale, string formattingCulture, string storedCulture)
    {
        var model = Build(Request(Daily, 2026, 40, 40, locale: locale), Array.Empty<AnalyticsTaskRow>());

        Assert.Equal(formattingCulture, model.Culture.Name);
        Assert.Equal(storedCulture, model.CultureName);
        Assert.IsType<GregorianCalendar>(model.Culture.DateTimeFormat.Calendar);
    }

    [Fact]
    public void Numbers_and_dates_follow_the_culture()
    {
        var nb = CultureInfo.GetCultureInfo("nb-NO");
        var us = CultureInfo.GetCultureInfo("en-US");
        var ar = CultureInfo.GetCultureInfo("ar-EG");
        const string nbsp = " ";

        Assert.Equal($"1{nb.NumberFormat.NumberGroupSeparator}234,5{nbsp}h", ReportFormatting.Hours(1234.46, nb));
        Assert.Equal($"1,234.5{nbsp}h", ReportFormatting.Hours(1234.46, us));
        Assert.Equal($"3{nbsp}h", ReportFormatting.Hours(3.04, us));
        Assert.Equal($"0{nbsp}h", ReportFormatting.Hours(double.NaN, us));
        Assert.Equal("38%", ReportFormatting.Percent(0.375, us));
        Assert.Equal("<1%", ReportFormatting.Percent(0.004, us));
        Assert.Equal("0%", ReportFormatting.Percent(0, us));
        Assert.Contains("38", ReportFormatting.Percent(0.375, nb));
        Assert.Equal("1,234", ReportFormatting.Count(1234, us));

        Assert.Equal("Week 40 of 2026 (9/28/2026 – 10/4/2026)", ReportFormatting.RangeLabel(new ReportSelection(Daily, 2026, 40, 40), us));
        Assert.Equal("Weeks 38–41 of 2026 (14.09.2026 – 11.10.2026)", ReportFormatting.RangeLabel(new ReportSelection(Weekly, 2026, 38, 41), nb));
        Assert.Equal("oktober 2026", ReportFormatting.RangeLabel(new ReportSelection(Monthly, 2026, 9, 9), nb));
        Assert.Equal("January 2026 – December 2026", ReportFormatting.RangeLabel(new ReportSelection(Monthly, 2026, 0, 11), us));

        // ar-EG: Arabic month names; no bidi marks left inside the English lines.
        var arabic = ReportFormatting.RangeLabel(new ReportSelection(Daily, 2026, 40, 40), ar);
        Assert.StartsWith("Week 40 of 2026 (", arabic);
        Assert.DoesNotContain('‏', arabic);
        Assert.DoesNotContain('؜', arabic);
        Assert.Contains("2026", arabic);
        Assert.Contains(ar.DateTimeFormat.GetMonthName(10), ReportFormatting.RangeLabel(new ReportSelection(Monthly, 2026, 9, 9), ar));
        var arabicHours = ReportFormatting.Hours(2.5, ar);
        Assert.Equal($"2{ar.NumberFormat.NumberDecimalSeparator}5{nbsp}h", arabicHours);

        Assert.Equal(("Monday, September 28, 2026", "Mon 28"), ReportFormatting.PeriodLabels(Daily, new DateTime(2026, 9, 28), us));
        Assert.Equal("mandag 28. september 2026", ReportFormatting.PeriodLabels(Daily, new DateTime(2026, 9, 28), nb).Label);
    }

    [Theory]
    [InlineData("Europe/Oslo", Daily, 2026, 40, 40, "Europe/Oslo (UTC+02:00)")]
    [InlineData("Europe/Oslo", Monthly, 2026, 0, 11, "Europe/Oslo (UTC+01:00/+02:00)")]
    [InlineData("America/New_York", Monthly, 2026, 0, 0, "America/New_York (UTC-05:00)")]
    [InlineData("America/St_Johns", Monthly, 2026, 0, 11, "America/St_Johns (UTC-03:30/-02:30)")]
    [InlineData("Asia/Kathmandu", Weekly, 2026, 1, 53, "Asia/Kathmandu (UTC+05:45)")]
    [InlineData("UTC", Weekly, 2026, 1, 53, "UTC")]
    [InlineData(null, Weekly, 2026, 1, 53, "UTC")]
    [InlineData("Not/AZone", Weekly, 2026, 1, 53, "UTC")]
    public void Zone_labels_show_every_offset_in_the_range(string? zone, string view, int year, int from, int to, string expected)
    {
        var model = Build(Request(view, year, from, to, zone), Array.Empty<AnalyticsTaskRow>());

        Assert.Equal(expected, model.TimeZoneLabel);
        Assert.Equal(zone is null or "Not/AZone" ? "UTC" : zone, model.TimeZoneId);
    }
}
