using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Features.Reports;
using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;

namespace TimePlanner.API.Tests.Unit.Reports;

/// <summary>Builders for report models and helpers to read generated PDFs.</summary>
internal static class ReportTestData
{
    public static readonly Guid Work = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid Gym = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static readonly Guid Standup = Guid.Parse("33333333-3333-3333-3333-333333333333");
    public static readonly Guid DeletedTemplateId = Guid.Parse("44444444-4444-4444-4444-444444444444");

    public static readonly DateTime GeneratedAt = new(2026, 10, 5, 8, 0, 0, DateTimeKind.Utc);
    public const string DocumentId = "TP-20261005-ABCD1234";

    public static AnalyticsTaskRow Row(string startUtc, double hours, Guid? category = null, string name = "Work",
        string color = "#2F7FE0", Guid? template = null) =>
        new(DateTime.Parse(startUtc, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal),
            hours, category ?? Work, name, color, template);

    public static ReportRequest Request(string view, int year, int from, int to, string? zone = "UTC", string? locale = "en-US",
        PaperSize? paper = null, string subject = "Ada Lovelace") => new()
    {
        Kind = ReportKind.Personal,
        Selection = new ReportSelection(view, year, from, to),
        TimeZoneId = zone,
        Locale = locale,
        Paper = paper,
        SubjectName = subject,
        GeneratedAtUtc = GeneratedAt,
        DocumentId = DocumentId
    };

    public static readonly Guid AdaId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    public const string Ada = "Ada Lovelace";

    /// <summary>A model from bare analytics rows: they become tasks "Task 01", "Task 02", … created by Ada.</summary>
    public static ReportModel Build(ReportRequest request, IEnumerable<AnalyticsTaskRow> tasks,
        IReadOnlyDictionary<Guid, AnalyticsTemplate>? templates = null) =>
        Build(request, tasks.Select((row, i) => new ReportTaskSource(
            IdOf(i + 1), $"Task {i + 1:D2}", row, null, AdaId, Ada, Array.Empty<string>(), GeneratedAt.AddDays(-30))), templates);

    public static ReportModel Build(ReportRequest request, IEnumerable<ReportTaskSource> tasks,
        IReadOnlyDictionary<Guid, AnalyticsTemplate>? templates = null) =>
        ReportModelBuilder.Build(request, tasks, templates ?? new Dictionary<Guid, AnalyticsTemplate>());

    /// <summary>A personal task (or, with <paramref name="organizationId"/>, an organization task assigned to Ada).</summary>
    public static ReportTaskSource PlannerTask(string title, string startUtc, double hours, Guid? id = null, Guid? category = null,
        string name = "Work", string color = "#2F7FE0", Guid? template = null, Guid? organizationId = null,
        string? organizationName = null, string createdBy = Ada, Guid? createdById = null, string[]? assignees = null,
        string createdOnUtc = "2026-09-01T10:15:00Z")
    {
        var start = Utc(startUtc);
        var row = organizationId is Guid org
            ? AnalyticsTaskRow.ForOrganizationTask(start, hours, org, organizationName ?? "Organization")
            : new AnalyticsTaskRow(start, hours, category ?? Work, name, color, template);
        // Default id: derived from the title, so it is the same in every run (golden files).
        return new ReportTaskSource(id ?? new Guid(System.Security.Cryptography.MD5.HashData(Encoding.UTF8.GetBytes(title))), title, row,
            organizationId is null ? null : organizationName ?? "Organization",
            createdById ?? AdaId, createdBy, assignees ?? Array.Empty<string>(), Utc(createdOnUtc));
    }

    public static Guid IdOf(int value) => new(value, 0, 0, new byte[8]);

    public static DateTime Utc(string instant) =>
        DateTime.Parse(instant, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);

    /// <summary>Text of every page in reading order, with all whitespace (incl. NBSP) collapsed to single spaces.</summary>
    public static string PdfText(byte[] pdf)
    {
        using var document = PdfDocument.Open(pdf);
        var text = new StringBuilder();
        foreach (var page in document.GetPages())
        {
            text.Append(ContentOrderTextExtractor.GetText(page)).Append('\n');
        }

        return Regex.Replace(text.ToString(), @"[\s  ]+", " ");
    }

    /// <summary>Writes the file to TIMEPLANNER_REPORT_DUMP_DIR when set (for looking at the output by hand).</summary>
    public static void Dump(string name, byte[] content)
    {
        var directory = Environment.GetEnvironmentVariable("TIMEPLANNER_REPORT_DUMP_DIR");
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
            File.WriteAllBytes(Path.Combine(directory, name), content);
        }
    }
}
