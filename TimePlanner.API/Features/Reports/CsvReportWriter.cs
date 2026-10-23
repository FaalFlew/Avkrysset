using System.Globalization;
using System.Text;
using TimePlanner.API.Features.Queries.Tasks;

namespace TimePlanner.API.Features.Reports;

/// <summary>
/// The analytics CSV shared with the browser's guest export (docs/plans/pdf-export-and-organizations.md §4.4):
/// UTF-8 with BOM, CRLF, RFC 4180 quoting; locale-aware delimiter/decimal (see <see cref="ReportLocale.CsvStyleFor"/>);
/// no thousands separators; hours with 2 decimals, Share % with 1 decimal.
/// <code>
/// # Time Planner analytics export
/// # Range: …
/// # Time zone: …
/// # Generated: 2026-10-05 10:00 (Europe/Oslo)
/// # Document ID: TP-…
/// Section,Key,Label,Category,Hours,Share %
/// Summary,total_hours,Total hours,,37.50,
/// Summary,task_count,Tasks,,12,
/// Summary,active_days,Active days,,9,
/// Summary,avg_hours_per_active_day,Average hours per active day,,4.17,
/// Summary,top_category,Top category,Work,20.00,53.3
/// Period,2026-W40,Week 40,,12.50,33.3        (every bucket, zero-filled)
/// Category,,Work,Work,20.00,53.3
/// Template,,Standup,Work,2.50,6.7
/// Template,without_template,Without template,,30.00,80.0
/// </code>
/// Text cells starting with = + - @ or a tab get a leading apostrophe (spreadsheet formula injection guard).
/// </summary>
public static class CsvReportWriter
{
    public const string ContentType = "text/csv; charset=utf-8";

    public static readonly string[] Header = { "Section", "Key", "Label", "Category", "Hours", "Share %" };

    public static byte[] Write(ReportModel model)
    {
        var (delimiter, decimalSeparator) = ReportLocale.CsvStyleFor(model.LocaleCulture);
        var csv = new Writer(delimiter, decimalSeparator);

        csv.Comment("Time Planner analytics export");
        csv.Comment($"Range: {model.RangeLabel}");
        csv.Comment($"Time zone: {model.TimeZoneLabel}");
        // ISO-style local time (not culture-formatted) so the line is unambiguous and machine-readable.
        var generated = TaskAnalyticsBreakdown.ToLocal(model.GeneratedAtUtc, model.TimeZone)
            .ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
        csv.Comment($"Generated: {generated} ({model.TimeZoneId})");
        csv.Comment($"Document ID: {model.DocumentId}");

        csv.Row(Header);

        var kpis = model.Kpis;
        csv.Row("Summary", "total_hours", "Total hours", "", csv.Hours(kpis.TotalHours), "");
        csv.Row("Summary", "task_count", "Tasks", "", kpis.TaskCount.ToString(CultureInfo.InvariantCulture), "");
        csv.Row("Summary", "active_days", "Active days", "", kpis.ActiveDays.ToString(CultureInfo.InvariantCulture), "");
        csv.Row("Summary", "avg_hours_per_active_day", "Average hours per active day", "", csv.Hours(kpis.AverageHoursPerActiveDay), "");
        csv.Row("Summary", "top_category", "Top category",
            kpis.TopCategory?.Name ?? "",
            kpis.TopCategory is null ? "" : csv.Hours(kpis.TopCategory.Hours),
            kpis.TopCategory is null ? "" : csv.Percent(kpis.TopCategory.Share));

        var total = kpis.TotalHours;
        foreach (var period in model.Periods)
        {
            csv.Row("Period", period.Key, period.Label, "", csv.Hours(period.Hours),
                csv.Percent(total > 0 ? period.Hours / total : 0));
        }

        foreach (var category in model.Categories)
        {
            csv.Row("Category", "", category.Name, category.Name, csv.Hours(category.Hours), csv.Percent(category.Share));
        }

        foreach (var template in model.Templates)
        {
            csv.Row("Template", template.IsWithoutTemplate ? "without_template" : "", template.Name,
                template.CategoryName ?? "", csv.Hours(template.Hours), csv.Percent(template.Share));
        }

        foreach (var member in model.Members)
        {
            csv.Row("Member", member.Email ?? "", member.Name, "", csv.Hours(member.Hours), csv.Percent(member.Share));
        }

        return csv.ToBytes();
    }

    /// <summary>Quotes a cell per RFC 4180 when needed and neutralizes spreadsheet formulas.</summary>
    public static string Cell(string value, char delimiter)
    {
        if (value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t')
        {
            value = "'" + value;
        }

        var needsQuotes = value.IndexOfAny(new[] { delimiter, '"', '\r', '\n' }) >= 0;
        return needsQuotes ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;
    }

    private sealed class Writer(char delimiter, char decimalSeparator)
    {
        private readonly StringBuilder _text = new();

        public void Comment(string text) => Line(Cell("# " + text, delimiter));

        public void Row(params string[] cells) =>
            Line(string.Join(delimiter, cells.Select(c => Cell(c, delimiter))));

        public string Hours(double hours) => Number(hours, "0.00");

        public string Percent(double share) => Number(share * 100, "0.0");

        public byte[] ToBytes()
        {
            var body = Encoding.UTF8.GetBytes(_text.ToString());
            var preamble = Encoding.UTF8.GetPreamble();
            var bytes = new byte[preamble.Length + body.Length];
            preamble.CopyTo(bytes, 0);
            body.CopyTo(bytes, preamble.Length);
            return bytes;
        }

        // Numbers are written by this code (not by the user) so they never need the formula guard:
        // "-0.00" cannot occur because hours are never negative, but Math.Max keeps it that way.
        private string Number(double value, string format)
        {
            var text = Math.Max(0, double.IsFinite(value) ? value : 0).ToString(format, CultureInfo.InvariantCulture);
            return decimalSeparator == '.' ? text : text.Replace('.', decimalSeparator);
        }

        private void Line(string line) => _text.Append(line).Append("\r\n");
    }
}
