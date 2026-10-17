using System.Diagnostics;
using TimePlanner.API.Features.Queries.Tasks;

namespace TimePlanner.API.Features.Reports;

/// <summary>
/// Renders a small sample report once after startup (in the background) so the first real export doesn't pay for
/// loading the native PDF engine and the fonts (~1 s). Disable with "Reports:WarmUp": false.
/// </summary>
public static class ReportWarmUp
{
    public static void Schedule(WebApplication app)
    {
        if (!app.Configuration.GetValue("Reports:WarmUp", true))
        {
            return;
        }

        app.Lifetime.ApplicationStarted.Register(() => _ = Task.Run(() =>
        {
            var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(ReportWarmUp));
            try
            {
                var stopwatch = Stopwatch.StartNew();
                var bytes = app.Services.GetRequiredService<IReportRenderer>().RenderPdf(SampleModel());
                logger.LogInformation("Report engine warmed up: sample PDF ({Bytes} bytes) in {Elapsed} ms.",
                    bytes.Length, stopwatch.ElapsedMilliseconds);
            }
            catch (Exception ex)
            {
                // Exports will retry the setup on demand; a failure here must not stop the app.
                logger.LogWarning(ex, "Report engine warm-up failed.");
            }
        }));
    }

    /// <summary>A fixed one-week personal report (also handy for smoke tests).</summary>
    public static ReportModel SampleModel(string? timeZoneId = "UTC", string? locale = "en-US", PaperSize? paper = null)
    {
        var category = Guid.Parse("8f6b2e1a-0c1d-4c55-9a51-6b0f2f0e9a01");
        var user = Guid.Parse("8f6b2e1a-0c1d-4c55-9a51-6b0f2f0e9a02");
        var start = new DateTime(2026, 9, 28, 9, 0, 0, DateTimeKind.Utc);
        var tasks = Enumerable.Range(0, 5)
            .Select(day => new ReportTaskSource(
                new Guid(day + 1, 0, 0, new byte[8]),
                "Focus block",
                new AnalyticsTaskRow(start.AddDays(day), 1.5, category, "Work", "#2F7FE0", null),
                null,
                user,
                "Time Planner",
                Array.Empty<string>(),
                start.AddDays(-1)))
            .ToList();

        return ReportModelBuilder.Build(new ReportRequest
        {
            Kind = ReportKind.Personal,
            Selection = new ReportSelection(TaskAnalyticsBreakdown.Daily, 2026, 40, 40),
            TimeZoneId = timeZoneId,
            Locale = locale,
            Paper = paper,
            SubjectName = "Time Planner",
            GeneratedAtUtc = new DateTime(2026, 10, 5, 8, 0, 0, DateTimeKind.Utc),
            DocumentId = "TP-20261005-WARM0000"
        }, tasks, new Dictionary<Guid, AnalyticsTemplate>());
    }
}
