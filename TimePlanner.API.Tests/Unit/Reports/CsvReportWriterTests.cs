using System.Text;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Features.Reports;
using static TimePlanner.API.Tests.Unit.Reports.ReportTestData;

namespace TimePlanner.API.Tests.Unit.Reports;

/// <summary>
/// The CSV format is shared with the frontend's guest export, so it is pinned by golden files
/// (Unit/Reports/Golden, stored byte-for-byte: see the .gitattributes next to them).
/// </summary>
public sealed class CsvReportWriterTests
{
    private static readonly Guid Formula = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly Guid Quoted = Guid.Parse("77777777-7777-7777-7777-777777777777");

    private static readonly AnalyticsTaskRow[] Week40 =
    {
        Row("2026-09-28T07:00:00Z", 2.5, template: Standup),
        Row("2026-09-29T07:00:00Z", 1.25),
        Row("2026-09-30T16:00:00Z", 1, Gym, "Gym", "#0E9C8C"),
        Row("2026-10-01T07:00:00Z", 0.5, Formula, "=HYPERLINK(\"http://x\")", "#B87D10"),
        Row("2026-10-02T07:00:00Z", 1234.5, Quoted, "Ops, \"night\"; shifts", "#8E55CC")
    };

    private static readonly Dictionary<Guid, AnalyticsTemplate> Templates = new()
    {
        [Standup] = new AnalyticsTemplate("-Standup", "Work", "#2F7FE0")
    };

    private static byte[] Csv(string locale, string zone = "Europe/Oslo") =>
        CsvReportWriter.Write(Build(Request(TaskAnalyticsBreakdown.Daily, 2026, 40, 40, zone, locale), Week40, Templates));

    [Theory]
    [InlineData("en-US", "weekly-en-US.csv")]
    [InlineData("nb-NO", "weekly-nb-NO.csv")]
    public void Matches_the_golden_file(string locale, string golden)
    {
        var actual = Csv(locale);
        Dump(golden, actual);

        var expected = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Unit", "Reports", "Golden", golden));
        Assert.Equal(Encoding.UTF8.GetString(expected), Encoding.UTF8.GetString(actual));
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void Is_utf8_with_bom_and_crlf_line_endings()
    {
        var bytes = Csv("en-US");

        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, bytes[..3]);
        var text = Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
        Assert.EndsWith("\r\n", text);
        Assert.DoesNotContain("\n", text.Replace("\r\n", ""));
        Assert.DoesNotContain("\r", text.Replace("\r\n", ""));
    }

    [Theory]
    [InlineData("en-US", ',', "1234.50")]
    [InlineData("en-GB", ',', "1234.50")]
    [InlineData("ja-JP", ',', "1234.50")]
    [InlineData(null, ',', "1234.50")]
    [InlineData("nb-NO", ';', "1234,50")]
    [InlineData("de-DE", ';', "1234,50")]
    [InlineData("fr-FR", ';', "1234,50")]
    public void Delimiter_and_decimal_separator_follow_the_locale(string? locale, char delimiter, string bigNumber)
    {
        var lines = Encoding.UTF8.GetString(Csv(locale!)).Split("\r\n");

        Assert.Equal(string.Join(delimiter, CsvReportWriter.Header), lines.Single(l => l.StartsWith("Section")));
        Assert.Contains(lines, l => l.StartsWith($"Period{delimiter}2026-10-02{delimiter}") && l.Contains(bigNumber));
        Assert.DoesNotContain(lines, l => l.Contains("1,234.5") || l.Contains("1 234") || l.Contains("1.234,5"));
    }

    [Theory]
    [InlineData("=SUM(A1)", ',', "'=SUM(A1)")]
    [InlineData("+1", ',', "'+1")]
    [InlineData("-1", ',', "'-1")]
    [InlineData("@cmd", ',', "'@cmd")]
    [InlineData("\tTab", ',', "'\tTab")]
    [InlineData("Plain", ',', "Plain")]
    [InlineData("a,b", ',', "\"a,b\"")]
    [InlineData("a,b", ';', "a,b")]
    [InlineData("a;b", ';', "\"a;b\"")]
    [InlineData("say \"hi\"", ',', "\"say \"\"hi\"\"\"")]
    [InlineData("two\nlines", ',', "\"two\nlines\"")]
    [InlineData("=a,b", ',', "\"'=a,b\"")]
    [InlineData("", ',', "")]
    public void Cells_are_quoted_and_guarded(string value, char delimiter, string expected)
    {
        Assert.Equal(expected, CsvReportWriter.Cell(value, delimiter));
    }
}
