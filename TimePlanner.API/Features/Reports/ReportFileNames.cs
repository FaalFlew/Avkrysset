using System.Globalization;
using System.Text;

namespace TimePlanner.API.Features.Reports;

/// <summary>
/// Download names: "time-planner-analytics-2026-W40.pdf", "time-planner-analytics-2026-W38_2026-W41.csv",
/// "time-planner-analytics-2026-10.pdf", "time-planner-analytics-2026-01_2026-12.pdf".
/// The daily view names the week it shows. Organization reports (Phase 4) use "time-planner-{org-slug}-…".
/// </summary>
public static class ReportFileNames
{
    public const string PersonalPrefix = "time-planner-analytics";

    public static string For(ReportSelection selection, ReportFormat format, string prefix = PersonalPrefix)
    {
        var extension = format == ReportFormat.Pdf ? "pdf" : "csv";
        return $"{prefix}-{RangePart(selection)}.{extension}";
    }

    public static string RangePart(ReportSelection selection)
    {
        string Key(int value) => selection.IsMonthly
            ? string.Create(CultureInfo.InvariantCulture, $"{selection.Year:D4}-{value + 1:D2}")
            : string.Create(CultureInfo.InvariantCulture, $"{selection.Year:D4}-W{value:D2}");

        return selection.From == selection.To ? Key(selection.From) : $"{Key(selection.From)}_{Key(selection.To)}";
    }

    /// <summary>"time-planner-{slug}" for an organization name: lower-case ASCII letters/digits and single dashes.</summary>
    public static string OrganizationPrefix(string organizationName)
    {
        var slug = Slug(organizationName);
        return slug.Length == 0 ? "time-planner-organization" : $"time-planner-{slug}";
    }

    public static string Slug(string text, int maxLength = 40)
    {
        var builder = new StringBuilder();
        foreach (var c in text.Normalize(NormalizationForm.FormD))
        {
            if (char.IsAsciiLetterOrDigit(c))
            {
                builder.Append(char.ToLowerInvariant(c));
            }
            else if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark
                     && builder.Length > 0 && builder[^1] != '-')
            {
                builder.Append('-');
            }

            if (builder.Length >= maxLength)
            {
                break;
            }
        }

        return builder.ToString().Trim('-');
    }

    /// <summary>
    /// <c>attachment; filename="…"; filename*=UTF-8''…</c> — the quoted name is an ASCII fallback, the
    /// RFC 5987 one carries the exact name.
    /// </summary>
    public static string ContentDisposition(string fileName)
    {
        var ascii = new StringBuilder(fileName.Length);
        foreach (var c in fileName)
        {
            ascii.Append(c is >= ' ' and <= '~' and not '"' and not '\\' ? c : '_');
        }

        return $"attachment; filename=\"{ascii}\"; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
    }
}
