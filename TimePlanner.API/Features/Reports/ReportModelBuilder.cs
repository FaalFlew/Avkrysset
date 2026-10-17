using TimePlanner.API.Data;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Reports;

/// <summary>Explicit inputs of a report: no HttpContext, so a background job can build the same report.</summary>
public sealed record ReportRequest
{
    public required ReportKind Kind { get; init; }
    public required ReportSelection Selection { get; init; }

    /// <summary>IANA zone the selection is resolved and bucketed in; null or unknown means UTC.</summary>
    public string? TimeZoneId { get; init; }

    /// <summary>BCP-47 locale for dates and numbers; null or unknown means the invariant culture.</summary>
    public string? Locale { get; init; }

    /// <summary>Paper size; null derives it from the locale's region.</summary>
    public PaperSize? Paper { get; init; }

    public required string SubjectName { get; init; }
    public string? OrganizationName { get; init; }
    public required DateTime GeneratedAtUtc { get; init; }
    public required string DocumentId { get; init; }
}

/// <summary>
/// Builds <see cref="ReportModel"/>s: loads the rows (same scope and grouping as the analytics page) and computes
/// KPIs, zero-filled periods, categories, templates and the task list.
/// </summary>
public sealed class ReportModelBuilder
{
    public const string ReportTitle = "Analytics report";
    public const string WithoutTemplate = "Without template";
    public const string DeletedTemplate = AnalyticsOrder.DeletedTemplateName;

    private readonly ApplicationDbContext _context;
    private readonly ILogger<ReportModelBuilder> _logger;

    public ReportModelBuilder(ApplicationDbContext context, ILogger<ReportModelBuilder> logger)
    {
        _context = context;
        _logger = logger;
    }

    /// <summary>
    /// A user's personal report: their planner (personal tasks + organization tasks assigned to them in organizations
    /// they are still in; organization tasks count under the organization's name, as on the analytics page).
    /// </summary>
    public async Task<ReportModel> BuildPersonalAsync(Guid userId, ReportRequest request, CancellationToken cancellationToken)
    {
        var (timeZoneId, timeZone) = ResolveZone(request.TimeZoneId, _logger);
        var (startUtc, endUtc) = ResolveRange(request.Selection, timeZone);

        var tasks = await ReportTaskList.ForPlannerAsync(_context, userId, startUtc, endUtc, cancellationToken);
        var templates = await AnalyticsTaskRows.TemplatesOfAsync(_context, tasks.Select(t => t.Row), cancellationToken);

        return Build(request with { TimeZoneId = timeZoneId }, tasks, templates);
    }

    /// <summary>The zone to use: the requested IANA id when this server can resolve it, else UTC.</summary>
    public static (string Id, TimeZoneInfo Zone) ResolveZone(string? timeZoneId, ILogger? logger = null)
    {
        var zone = TimeZoneResolver.ResolveOrUtc(timeZoneId, logger);
        return ReferenceEquals(zone, TimeZoneInfo.Utc) || string.IsNullOrWhiteSpace(timeZoneId)
            ? ("UTC", TimeZoneInfo.Utc)
            : (timeZoneId, zone);
    }

    /// <summary>The selection's half-open UTC range in <paramref name="timeZone"/>; 400 if it spans more than 400 days.</summary>
    public static (DateTime StartUtc, DateTime EndUtc) ResolveRange(ReportSelection selection, TimeZoneInfo timeZone)
    {
        var (startUtc, endUtc) = selection.Resolve(timeZone);
        if (endUtc - startUtc > ReportSelection.MaxSpan)
        {
            throw new BadRequestException($"A report can cover at most {ReportSelection.MaxSpan.TotalDays} days.");
        }

        return (startUtc, endUtc);
    }

    /// <summary>
    /// Pure part: the model for <paramref name="tasks"/> (tasks outside the selection's range are ignored). The KPIs,
    /// breakdowns and the task list come from the same rows, summed in task-list order, so the task list's count and
    /// hours equal the KPIs exactly.
    /// </summary>
    public static ReportModel Build(
        ReportRequest request,
        IEnumerable<ReportTaskSource> tasks,
        IReadOnlyDictionary<Guid, AnalyticsTemplate> templates)
    {
        var (timeZoneId, timeZone) = ResolveZone(request.TimeZoneId);
        var selection = request.Selection;
        var (startUtc, endUtc) = ResolveRange(selection, timeZone);
        var localeCulture = ReportLocale.CultureFor(request.Locale);
        var culture = ReportLocale.FormattingCultureFor(localeCulture);

        var sources = ReportTaskList.Order(
            tasks.Where(t => t.Row.Start >= startUtc && t.Row.Start < endUtc),
            t => t.Row.Start, t => t.Title, t => t.Id);
        var rows = sources.Select(t => t.Row).ToList();
        var totalHours = rows.Sum(t => t.Duration);
        double ShareOf(double hours) => totalHours > 0 ? hours / totalHours : 0;

        // Same order as the analytics API (AnalyticsOrder); the first one is the top category.
        var categories = AnalyticsOrder.Sort(
                rows
                    .GroupBy(t => t.CategoryId)
                    .Select(g => (Id: g.Key, g.First().CategoryName, g.First().CategoryColor, Hours: g.Sum(t => t.Duration))),
                c => c.Hours, c => c.CategoryName, c => c.Id)
            .Select(c => new ReportCategory(c.CategoryName, c.CategoryColor, c.Hours, ShareOf(c.Hours)))
            .ToList();

        var activeDays = rows
            .Select(t => TaskAnalyticsBreakdown.ToLocal(t.Start, timeZone).Date)
            .Distinct()
            .Count();

        var kpis = new ReportKpis(
            totalHours,
            rows.Count,
            activeDays,
            activeDays > 0 ? totalHours / activeDays : 0,
            categories.FirstOrDefault());

        return new ReportModel
        {
            DocumentId = request.DocumentId,
            Kind = request.Kind,
            Title = ReportTitle,
            SubjectName = request.SubjectName,
            OrganizationName = request.OrganizationName,
            Selection = selection,
            RangeStartUtc = startUtc,
            RangeEndUtc = endUtc,
            RangeLabel = ReportFormatting.RangeLabel(selection, culture),
            TimeZoneId = timeZoneId,
            TimeZone = timeZone,
            TimeZoneLabel = ReportFormatting.ZoneLabel(timeZoneId, timeZone, startUtc, endUtc),
            LocaleCulture = localeCulture,
            Culture = culture,
            Paper = request.Paper ?? ReportLocale.PaperFor(localeCulture),
            GeneratedAtUtc = DateTime.SpecifyKind(request.GeneratedAtUtc, DateTimeKind.Utc),
            Kpis = kpis,
            Periods = Periods(selection, rows, timeZone, startUtc, endUtc, culture),
            Categories = categories,
            Templates = Templates(rows, templates, totalHours),
            Tasks = sources.Select(t => ReportTaskList.ToTask(t, templates)).ToList()
        };
    }

    private static List<ReportPeriod> Periods(
        ReportSelection selection,
        List<AnalyticsTaskRow> rows,
        TimeZoneInfo timeZone,
        DateTime startUtc,
        DateTime endUtc,
        System.Globalization.CultureInfo culture)
    {
        var breakdown = TaskAnalyticsBreakdown.Build(rows, selection.View, timeZone).ToDictionary(p => p.Key);

        return TaskAnalyticsBreakdown.EnumerateBuckets(startUtc, endUtc, selection.View, timeZone)
            .Select(bucket =>
            {
                var bucketStart = TaskAnalyticsBreakdown.ToLocal(bucket.StartUtc, timeZone).Date;
                if (selection.IsMonthly)
                {
                    bucketStart = new DateTime(bucketStart.Year, bucketStart.Month, 1);
                }

                var (label, shortLabel) = ReportFormatting.PeriodLabels(selection.View, bucketStart, culture);
                return breakdown.TryGetValue(bucket.Key, out var point)
                    ? new ReportPeriod(bucket.Key, label, shortLabel, point.Value, point.DominantCategoryColor)
                    : new ReportPeriod(bucket.Key, label, shortLabel, 0, null);
            })
            .ToList();
    }

    private static List<ReportTemplate> Templates(
        List<AnalyticsTaskRow> rows,
        IReadOnlyDictionary<Guid, AnalyticsTemplate> templates,
        double totalHours)
    {
        double ShareOf(double hours) => totalHours > 0 ? hours / totalHours : 0;

        var list = AnalyticsOrder.Sort(
                rows
                    .Where(t => t.TemplateId.HasValue)
                    .GroupBy(t => t.TemplateId!.Value)
                    .Select(g =>
                    {
                        var hours = g.Sum(t => t.Duration);
                        var row = templates.TryGetValue(g.Key, out var template)
                            ? new ReportTemplate(template.Title, template.CategoryName, template.CategoryColor, hours, ShareOf(hours), false)
                            : new ReportTemplate(DeletedTemplate, null, null, hours, ShareOf(hours), false);
                        return (Id: g.Key, Row: row);
                    }),
                t => t.Row.Hours, t => t.Row.Name, t => t.Id)
            .Select(t => t.Row)
            .ToList();

        // Always present (also when it is 0) so the CSV has a stable shape.
        var untemplated = rows.Where(t => !t.TemplateId.HasValue).Sum(t => t.Duration);
        list.Add(new ReportTemplate(WithoutTemplate, null, null, untemplated, ShareOf(untemplated), true));
        return list;
    }
}
