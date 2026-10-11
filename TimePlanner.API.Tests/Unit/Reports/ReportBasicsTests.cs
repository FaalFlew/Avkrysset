using System.Text.RegularExpressions;
using TimePlanner.API.Features.Reports;

namespace TimePlanner.API.Tests.Unit.Reports;

/// <summary>Document IDs, file names, chart geometry helpers and font coverage.</summary>
public sealed class ReportBasicsTests
{
    [Fact]
    public void Document_ids_have_the_date_and_8_crockford_characters()
    {
        var ids = Enumerable.Range(0, 2000).Select(_ => DocumentIds.New(new DateTime(2026, 10, 11, 23, 59, 0, DateTimeKind.Utc))).ToList();

        Assert.All(ids, id =>
        {
            Assert.Matches(new Regex("^TP-20261011-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$"), id);
            Assert.True(DocumentIds.IsValid(id));
        });
        Assert.Equal(ids.Count, ids.Distinct().Count());
        // 40 random bits: every alphabet character shows up in 16 000 characters.
        Assert.Equal(DocumentIds.Alphabet.Length, ids.SelectMany(id => id[12..]).Distinct().Count());
    }

    [Theory]
    [InlineData("TP-20261011-ABCDEFGH", true)]
    [InlineData("TP-20261011-ABCDEFGI", false)] // I is not Crockford
    [InlineData("TP-20261011-ABCDEFG", false)]
    [InlineData("tp-20261011-ABCDEFGH", false)]
    [InlineData(null, false)]
    public void Document_id_validation(string? id, bool valid) => Assert.Equal(valid, DocumentIds.IsValid(id));

    [Theory]
    [InlineData("weekly", 2026, 40, 40, ReportFormat.Pdf, "time-planner-analytics-2026-W40.pdf")]
    [InlineData("weekly", 2026, 38, 41, ReportFormat.Csv, "time-planner-analytics-2026-W38_2026-W41.csv")]
    [InlineData("daily", 2026, 1, 1, ReportFormat.Pdf, "time-planner-analytics-2026-W01.pdf")]
    [InlineData("monthly", 2026, 0, 11, ReportFormat.Pdf, "time-planner-analytics-2026-01_2026-12.pdf")]
    [InlineData("monthly", 2026, 9, 9, ReportFormat.Csv, "time-planner-analytics-2026-10.csv")]
    public void File_names_describe_the_selection(string view, int year, int from, int to, ReportFormat format, string expected)
    {
        Assert.Equal(expected, ReportFileNames.For(new ReportSelection(view, year, from, to), format));
    }

    [Theory]
    [InlineData("Acme AS", "time-planner-acme-as")]
    [InlineData("  Åsane Fotball & Co!  ", "time-planner-asane-fotball-co")]
    [InlineData("العمل", "time-planner-organization")]
    public void Organization_prefixes_are_slugs(string name, string expected) =>
        Assert.Equal(expected, ReportFileNames.OrganizationPrefix(name));

    [Fact]
    public void Content_disposition_has_an_ascii_name_and_the_exact_utf8_name()
    {
        Assert.Equal(
            "attachment; filename=\"time-planner-analytics-2026-W40.pdf\"; filename*=UTF-8''time-planner-analytics-2026-W40.pdf",
            ReportFileNames.ContentDisposition("time-planner-analytics-2026-W40.pdf"));
        Assert.Equal(
            "attachment; filename=\"time-planner-_s-2026.pdf\"; filename*=UTF-8''time-planner-%C3%A5s-2026.pdf",
            ReportFileNames.ContentDisposition("time-planner-ås-2026.pdf"));
    }

    [Theory]
    [InlineData(0, 4, 1)]
    [InlineData(3, 4, 1)]
    [InlineData(4.2, 8, 2)]
    [InlineData(9, 10, 2.5)]
    [InlineData(37.5, 40, 10)]
    [InlineData(0.4, 0.4, 0.1)]
    [InlineData(1234.5, 2000, 500)]
    public void Value_axes_use_nice_steps(double max, double axisMax, double step)
    {
        var (actualMax, actualStep) = ReportCharts.NiceAxis(max);
        Assert.Equal(axisMax, actualMax, 6);
        Assert.Equal(step, actualStep, 6);
    }

    [Fact]
    public void Charts_are_svg_with_invariant_numbers_and_safe_colors()
    {
        var bars = ReportCharts.BarChart(new[] { (2.5, (string?)"#2F7FE0"), (0d, null), (1d, "red\"/><script>") }, 4, 300.5f, 150);
        Assert.StartsWith("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"300.5\"", bars);
        Assert.DoesNotContain("<script", bars);
        Assert.Contains(ReportCharts.NeutralColor, bars);
        Assert.Equal(2, Regex.Matches(bars, "<path ").Count); // the zero bar is not drawn

        var donut = ReportCharts.Donut(new[] { new ReportCharts.Slice(3, "#2F7FE0"), new ReportCharts.Slice(1, "#0E9C8C") }, 120);
        Assert.Equal(2, Regex.Matches(donut, "<path ").Count);
        Assert.Contains(" A", donut);

        var full = ReportCharts.Donut(new[] { new ReportCharts.Slice(5, "#2F7FE0") }, 120);
        Assert.Contains("<circle", full);

        Assert.Equal("#ABC", ReportCharts.SafeColor("#ABC"));
        Assert.Equal(ReportCharts.NeutralColor, ReportCharts.SafeColor("url(#x)"));
        Assert.Equal(ReportCharts.NeutralColor, ReportCharts.SafeColor(null));
    }

    [Theory]
    [InlineData("Work, Gym, Ελληνικά, Русский, Ünïcödé")]
    [InlineData("العمل اليومي ١٢٣ ٪")]
    [InlineData("עבודה שוטפת")]
    [InlineData("工作 仕事 カテゴリ 업무 한국어")]
    [InlineData("🏃 ✅ 📅 ⏰")]
    [InlineData("👩‍💻 ❤️")] // ZWJ sequence and a variation selector
    public void The_embedded_fonts_cover_the_supported_scripts(string text)
    {
        Assert.Empty(ReportFonts.MissingCodePoints(new[] { text }));
    }

    [Fact]
    public void Uncovered_scripts_are_reported_by_code_point()
    {
        var missing = ReportFonts.MissingCodePoints(new[] { "Work ภาษาไทย" });

        Assert.Contains(0x0E20, missing); // Thai
        Assert.Equal("U+0E20, U+0E32", ReportFonts.Describe(new[] { 0x0E20, 0x0E32 }));
    }
}
