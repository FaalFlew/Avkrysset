using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace TimePlanner.API.Features.Reports;

/// <summary>Turns a <see cref="ReportModel"/> into a file. Stateless and thread-safe.</summary>
public interface IReportRenderer
{
    byte[] RenderPdf(ReportModel model);
}

/// <summary>
/// The analytics report as a printable PDF (QuestPDF): header, KPI tiles, time per period (bar chart),
/// time per category (donut + table), time per template, the task list, and a footer with generation time, document ID and
/// page numbers. Light print styling on A4 or US Letter.
/// </summary>
public sealed class PdfReportRenderer : IReportRenderer
{
    private const string Ink = "#1F2933";
    private const string Secondary = "#52606D";
    private const string Muted = "#7B8794";
    private const string Accent = "#2F6FD0";
    private const string Rule = "#E4E7EB";
    private const string Tile = "#F5F7FA";

    /// <summary>More bars than this get thinned axis labels and no per-bar values.</summary>
    private const int MaxLabelledBars = 14;
    /// <summary>The donut shows this many categories; the rest are merged into "Other".</summary>
    private const int MaxDonutSlices = 8;

    private readonly ILogger<PdfReportRenderer> _logger;

    public PdfReportRenderer(ILogger<PdfReportRenderer> logger)
    {
        _logger = logger;
    }

    public byte[] RenderPdf(ReportModel model)
    {
        ReportFonts.EnsureInitialized();
        WarnAboutMissingGlyphs(model);

        return Document
            .Create(document => document.Page(page => ComposePage(page, model)))
            .WithMetadata(new DocumentMetadata
            {
                Title = $"{model.Title} – {model.RangeLabel}",
                Subject = $"Time Planner analytics, {model.RangeLabel}, {model.TimeZoneLabel}",
                Author = "Time Planner",
                Creator = "Time Planner",
                Producer = "Time Planner",
                Keywords = model.DocumentId,
                Language = string.IsNullOrEmpty(model.Culture.Name) ? "en" : model.Culture.Name,
                CreationDate = new DateTimeOffset(model.GeneratedAtUtc, TimeSpan.Zero),
                ModifiedDate = new DateTimeOffset(model.GeneratedAtUtc, TimeSpan.Zero)
            })
            .GeneratePdf();
    }

    private void WarnAboutMissingGlyphs(ReportModel model)
    {
        var texts = new List<string?> { model.SubjectName, model.OrganizationName, model.RangeLabel, model.TimeZoneLabel };
        texts.AddRange(model.Categories.Select(c => c.Name));
        texts.AddRange(model.Templates.SelectMany(t => new[] { t.Name, t.CategoryName }));
        texts.AddRange(model.Members.Select(m => m.Name));
        texts.AddRange(model.Periods.SelectMany(p => new[] { p.Label, p.ShortLabel }));
        texts.AddRange(model.Tasks.Take(ReportTaskList.MaxPdfRows)
            .SelectMany(t => new[] { t.Title, t.CategoryName, t.TemplateTitle, t.CreatedByDisplayName, t.OrganizationName }));

        var missing = ReportFonts.MissingCodePoints(texts);
        if (missing.Count > 0)
        {
            // Code points only: names themselves are user data.
            _logger.LogWarning(
                "Report {DocumentId}: no font has glyphs for {CodePoints}; they render blank.",
                model.DocumentId, ReportFonts.Describe(missing));
        }
    }

    private static void ComposePage(PageDescriptor page, ReportModel model)
    {
        page.Size(model.Paper == PaperSize.Letter ? PageSizes.Letter : PageSizes.A4);
        page.Margin(PageMarginMm, Unit.Millimetre);
        page.PageColor(Colors.White);
        page.DefaultTextStyle(style => style.FontFamily(ReportFonts.Families).FontSize(9).FontColor(Ink));

        page.Header().Element(container => ComposeHeader(container, model));
        page.Content().PaddingTop(14).Element(container => ComposeContent(container, model));
        page.Footer().Element(container => ComposeFooter(container, model));
    }

    private static void ComposeHeader(IContainer container, ReportModel model)
    {
        container.Column(column =>
        {
            column.Item().Row(row =>
            {
                row.RelativeItem().Column(left =>
                {
                    left.Item().Text("TIME PLANNER").FontSize(7.5f).Bold().FontColor(Accent).LetterSpacing(0.08f);
                    left.Item().PaddingTop(2).Text(model.Title).FontSize(18).Bold();
                    left.Item().PaddingTop(2).Text(SubjectLine(model)).FontColor(Secondary);
                });

                row.RelativeItem().AlignRight().AlignBottom().Column(right =>
                {
                    right.Item().AlignRight().Text(model.RangeLabel).FontSize(10).Bold();
                    right.Item().AlignRight().Text($"Time zone: {model.TimeZoneLabel}").FontColor(Secondary);
                    right.Item().AlignRight().Text(ViewLabel(model.Selection)).FontColor(Secondary);
                });
            });

            column.Item().PaddingTop(8).LineHorizontal(0.75f).LineColor(Rule);
        });
    }

    private static void ComposeContent(IContainer container, ReportModel model)
    {
        container.Column(column =>
        {
            column.Spacing(16);
            column.Item().Element(c => ComposeKpis(c, model));

            if (model.Kpis.TaskCount == 0)
            {
                column.Item().Background(Tile).CornerRadius(4).Padding(14).Column(empty =>
                {
                    empty.Item().Text("No tasks in this period.").Bold();
                    empty.Item().PaddingTop(2).Text("Tasks you plan in Time Planner for this range will appear here.").FontColor(Secondary);
                });
                return;
            }

            // The chart is never split; long tables continue on the next page (their header row repeats), but a
            // section only starts where its title and first rows (or the donut) fit.
            column.Item().ShowEntire().Element(c => ComposePeriodChart(c, model));
            column.Item().EnsureSpace(170).Element(c => ComposeCategories(c, model));
            column.Item().EnsureSpace(90).Element(c => ComposeTemplates(c, model));
            column.Item().EnsureSpace(110).Element(c => ComposeTasks(c, model));
        });
    }

    private static void ComposeKpis(IContainer container, ReportModel model)
    {
        var culture = model.Culture;
        var kpis = model.Kpis;
        container.Row(row =>
        {
            row.Spacing(8);
            KpiTile(row.RelativeItem(), "Total time", ReportFormatting.Hours(kpis.TotalHours, culture), null);
            KpiTile(row.RelativeItem(), "Tasks", ReportFormatting.Count(kpis.TaskCount, culture), null);
            KpiTile(row.RelativeItem(), "Active days", ReportFormatting.Count(kpis.ActiveDays, culture), null);
            KpiTile(row.RelativeItem(), "Avg per active day", ReportFormatting.Hours(kpis.AverageHoursPerActiveDay, culture), null);
            KpiTile(row.RelativeItem(1.4f), "Top category",
                kpis.TopCategory?.Name ?? "–",
                kpis.TopCategory is null
                    ? null
                    : $"{ReportFormatting.Hours(kpis.TopCategory.Hours, culture)} · {ReportFormatting.Percent(kpis.TopCategory.Share, culture)}",
                smallValue: true);
        });
    }

    private static void KpiTile(IContainer container, string label, string value, string? detail, bool smallValue = false)
    {
        container.Background(Tile).Border(0.75f).BorderColor(Rule).CornerRadius(4).Padding(8).Column(tile =>
        {
            // One label line in every tile, so all values sit on the same line.
            tile.Item().Text(label).FontSize(7.5f).FontColor(Muted).ClampLines(1);
            tile.Item().PaddingTop(3).Text(value).FontSize(smallValue ? 11 : 15).Bold().ClampLines(2);
            if (detail is not null)
            {
                tile.Item().PaddingTop(1).Text(detail).FontSize(7.5f).FontColor(Secondary);
            }
        });
    }

    private static void ComposePeriodChart(IContainer container, ReportModel model)
    {
        const float chartHeight = 150;
        const float gutter = 34;

        var culture = model.Culture;
        var periods = model.Periods;
        var (axisMax, step) = ReportCharts.NiceAxis(periods.Count == 0 ? 0 : periods.Max(p => p.Hours));
        var bars = periods.Select(p => (p.Hours, p.Color)).ToList();
        var labelled = periods.Count <= MaxLabelledBars;
        var every = labelled ? 1 : (int)Math.Ceiling(periods.Count / 13.0);

        container.Column(column =>
        {
            column.Item().Element(c => SectionTitle(c, $"Time by {PeriodNoun(model.Selection)}"));

            column.Item().PaddingTop(6).Row(row =>
            {
                // Value axis: one label per gridline from the top, vertically centred on the line.
                row.ConstantItem(gutter).Height(chartHeight).Column(axis =>
                {
                    for (var i = 0; i < ReportCharts.AxisIntervals; i++)
                    {
                        var value = axisMax - i * step;
                        axis.Item().Height(chartHeight / ReportCharts.AxisIntervals).PaddingRight(4).AlignRight()
                            .OffsetY(-4).Text(ReportFormatting.Hours(value, culture)).FontSize(6.5f).FontColor(Muted);
                    }
                });

                row.RelativeItem().Height(chartHeight).Svg(size => ReportCharts.BarChart(bars, axisMax, size.Width, size.Height));
            });

            column.Item().PaddingTop(3).Row(row =>
            {
                row.ConstantItem(gutter).PaddingRight(4).AlignRight().OffsetY(-7)
                    .Text(ReportFormatting.Hours(0, culture)).FontSize(6.5f).FontColor(Muted);

                for (var i = 0; i < periods.Count; i += every)
                {
                    var period = periods[i];
                    var span = Math.Min(every, periods.Count - i);
                    var cell = row.RelativeItem(span);
                    if (labelled)
                    {
                        cell.AlignCenter().Column(label =>
                        {
                            label.Item().AlignCenter().Text(period.ShortLabel).FontSize(7).FontColor(Secondary);
                            label.Item().AlignCenter().Text(ReportFormatting.Hours(period.Hours, culture)).FontSize(7)
                                .FontColor(period.Hours > 0 ? Ink : Muted);
                        });
                    }
                    else
                    {
                        cell.Text(period.ShortLabel).FontSize(7).FontColor(Secondary);
                    }
                }
            });
        });
    }

    private static void ComposeCategories(IContainer container, ReportModel model)
    {
        var culture = model.Culture;
        var slices = model.Categories.Take(MaxDonutSlices)
            .Select(c => new ReportCharts.Slice(c.Hours, c.Color))
            .ToList();
        if (model.Categories.Count > MaxDonutSlices)
        {
            slices.Add(new ReportCharts.Slice(model.Categories.Skip(MaxDonutSlices).Sum(c => c.Hours), ReportCharts.NeutralColor));
        }

        container.Column(column =>
        {
            column.Item().Element(c => SectionTitle(c, "Time by category"));
            column.Item().PaddingTop(8).Row(row =>
            {
                // ShowOnce: when the table continues on the next page, the donut is not drawn again.
                row.ConstantItem(128).ShowOnce().Height(128).Layers(layers =>
                {
                    layers.PrimaryLayer().Svg(size => ReportCharts.Donut(slices, Math.Min(size.Width, size.Height)));
                    layers.Layer().AlignCenter().AlignMiddle().Column(center =>
                    {
                        center.Item().AlignCenter().Text(ReportFormatting.Hours(model.Kpis.TotalHours, culture)).FontSize(12).Bold();
                        center.Item().AlignCenter().Text("total").FontSize(7).FontColor(Muted);
                    });
                });

                row.ConstantItem(18);
                row.RelativeItem().Table(table =>
                {
                    table.ColumnsDefinition(columns =>
                    {
                        columns.ConstantColumn(14);
                        columns.RelativeColumn(4);
                        columns.RelativeColumn(1.4f);
                        columns.RelativeColumn(1.1f);
                    });

                    table.Header(header =>
                    {
                        header.Cell().Element(HeaderCell);
                        header.Cell().Element(HeaderCell).Text("Category");
                        header.Cell().Element(HeaderCell).AlignRight().Text("Hours");
                        header.Cell().Element(HeaderCell).AlignRight().Text("Share");
                    });

                    foreach (var category in model.Categories)
                    {
                        table.Cell().Element(BodyCell).AlignMiddle().Width(8).Height(8)
                            .Svg(_ => ReportCharts.Swatch(category.Color, 8));
                        table.Cell().Element(BodyCell).Text(category.Name);
                        table.Cell().Element(BodyCell).AlignRight().Text(ReportFormatting.Hours(category.Hours, culture));
                        table.Cell().Element(BodyCell).AlignRight().Text(ReportFormatting.Percent(category.Share, culture));
                    }
                });
            });
        });
    }

    private static void ComposeTemplates(IContainer container, ReportModel model)
    {
        var culture = model.Culture;
        container.Column(column =>
        {
            column.Item().Element(c => SectionTitle(c, "Time by template"));
            column.Item().PaddingTop(6).Table(table =>
            {
                table.ColumnsDefinition(columns =>
                {
                    columns.RelativeColumn(4);
                    columns.RelativeColumn(3);
                    columns.RelativeColumn(1.4f);
                    columns.RelativeColumn(1.1f);
                });

                table.Header(header =>
                {
                    header.Cell().Element(HeaderCell).Text("Template");
                    header.Cell().Element(HeaderCell).Text("Category");
                    header.Cell().Element(HeaderCell).AlignRight().Text("Hours");
                    header.Cell().Element(HeaderCell).AlignRight().Text("Share");
                });

                foreach (var template in model.Templates)
                {
                    var color = template.IsWithoutTemplate ? Muted : Ink;
                    table.Cell().Element(BodyCell).Text(template.Name).FontColor(color).Italic(template.IsWithoutTemplate);
                    table.Cell().Element(BodyCell).Text(template.CategoryName ?? "").FontColor(Secondary);
                    table.Cell().Element(BodyCell).AlignRight().Text(ReportFormatting.Hours(template.Hours, culture)).FontColor(color);
                    table.Cell().Element(BodyCell).AlignRight().Text(ReportFormatting.Percent(template.Share, culture)).FontColor(color);
                }
            });
        });
    }

    /// <summary>
    /// Every task of the range (at most <see cref="ReportTaskList.MaxPdfRows"/>), grouped by local start day, in the
    /// analytics page's column order. The column header repeats on every page; a day's header row is kept on the page of
    /// its first task and rows never split. The total row equals the KPIs (same rows, same sum). A capped list says so
    /// above the table, in the total row, in the header of a day that is cut off, and again under the total.
    /// </summary>
    private static void ComposeTasks(IContainer container, ReportModel model)
    {
        var culture = model.Culture;
        var zone = model.TimeZone;
        var shown = Math.Min(model.Tasks.Count, ReportTaskList.MaxPdfRows);
        var capNote = shown < model.Tasks.Count
            ? $"Showing the first {ReportFormatting.Count(shown, culture)} of {ReportFormatting.Count(model.Tasks.Count, culture)} " +
              "tasks — use Task list (CSV) for the complete list."
            : null;

        // One parsed swatch per color, shared by all rows.
        var swatches = new Dictionary<string, SvgImage>(StringComparer.Ordinal);
        var showOrganization = model.Tasks.Any(t => t.OrganizationName is not null);
        var durationWidth = DurationColumnWidth(model.Tasks.Take(shown).Select(t => t.DurationHours), model.Kpis.TotalHours);
        var layout = new TaskTableLayout(
            showOrganization,
            durationWidth,
            TaskColumnWidth(model.Paper, showOrganization, durationWidth, TaskCreatedByColumn),
            color =>
            {
                var safe = ReportCharts.SafeColor(color);
                if (!swatches.TryGetValue(safe, out var image))
                {
                    image = SvgImage.FromText(ReportCharts.Swatch(safe, 8));
                    swatches[safe] = image;
                }

                return image;
            });

        container.Column(column =>
        {
            column.Item().Element(c => SectionTitle(c, "Tasks"));
            if (capNote is not null)
            {
                column.Item().PaddingTop(6).Background(Tile).BorderLeft(2).BorderColor(Accent).PaddingVertical(5).PaddingHorizontal(8)
                    .Text(capNote).FontSize(8).FontColor(Ink);
            }

            column.Item().PaddingTop(6).Decoration(decoration =>
            {
                decoration.Before()
                    .BorderBottom(0.75f).BorderColor(Rule).PaddingVertical(4)
                    .DefaultTextStyle(style => style.FontSize(7.5f).FontColor(Muted))
                    .Element(c => TaskColumns(c, layout,
                        cell => cell.Text("Time"),
                        cell => cell.AlignRight().Text("Duration"),
                        cell => cell.Text("Title"),
                        cell => cell.Text("Category"),
                        cell => cell.Text("Template"),
                        cell => cell.Text("Organization"),
                        cell => cell.Text("Created by")));

                decoration.Content().Column(list =>
                {
                    var remaining = shown;
                    foreach (var day in ReportTaskList.Days(model.Tasks, zone))
                    {
                        if (remaining == 0)
                        {
                            break;
                        }

                        var tasks = day.Tasks.Take(remaining).ToList();
                        remaining -= tasks.Count;

                        // The day's header row never ends a page: it stays with the day's first task.
                        list.Item().PreventPageBreak().Column(group =>
                        {
                            group.Item().Element(c => TaskDayHeader(c, day, tasks.Count, culture));
                            group.Item().Element(c => TaskRow(c, tasks[0], model, layout));
                        });

                        foreach (var task in tasks.Skip(1))
                        {
                            list.Item().PreventPageBreak().Element(c => TaskRow(c, task, model, layout));
                        }
                    }

                    // The note under the total stays on the total's page.
                    list.Item().PreventPageBreak().Column(end =>
                    {
                        end.Item().Element(c => TaskTotalRow(c, model, shown, layout));
                        if (capNote is not null)
                        {
                            end.Item().PaddingTop(6).Text(capNote).FontSize(8).Italic().FontColor(Secondary);
                        }
                    });
                });
            });
        });
    }

    /// <param name="DurationWidth">Fixed width of the Duration column, wide enough that no duration wraps.</param>
    /// <param name="CreatedByWidth">Width of the Created by column (to lay out email addresses).</param>
    private sealed record TaskTableLayout(bool ShowOrganization, float DurationWidth, float CreatedByWidth, Func<string, SvgImage> Swatch);

    private const float PageMarginMm = 14;
    private const float TaskColumnSpacing = 6;
    private const int TaskDurationColumn = 1;
    private const int TaskOrganizationColumn = 5;
    private const int TaskCreatedByColumn = 6;

    /// <summary>Relative widths of Time, (Duration: fixed), Title, Category, Template, Organization, Created by.</summary>
    private static readonly float[] TaskColumnWeights = { 3f, 0, 4f, 2.5f, 2.1f, 2.1f, 2.1f };

    /// <summary>
    /// Time, Duration, Title, Category, Template, Organization (only when a task has one) and Created by — the analytics
    /// page's order. Duration has a fixed width; the others share the rest.
    /// </summary>
    private static void TaskColumns(IContainer container, TaskTableLayout layout, params Action<IContainer>[] cells)
    {
        container.Row(row =>
        {
            row.Spacing(TaskColumnSpacing);
            for (var i = 0; i < cells.Length; i++)
            {
                if (i == TaskOrganizationColumn && !layout.ShowOrganization)
                {
                    continue;
                }

                var item = i == TaskDurationColumn ? row.ConstantItem(layout.DurationWidth) : row.RelativeItem(TaskColumnWeights[i]);
                // AlignMiddle: a cell whose text uses a taller fallback font (e.g. CJK) stays centred with its neighbours.
                item.AlignMiddle().Element(cells[i]);
            }
        });
    }

    /// <summary>The width <see cref="TaskColumns"/> gives column <paramref name="index"/> on <paramref name="paper"/>.</summary>
    private static float TaskColumnWidth(PaperSize paper, bool showOrganization, float durationWidth, int index)
    {
        var pageWidth = paper == PaperSize.Letter ? PageSizes.Letter.Width : PageSizes.A4.Width;
        var contentWidth = pageWidth - 2 * PageMarginMm * 72 / 25.4f;
        var columns = showOrganization ? TaskColumnWeights.Length : TaskColumnWeights.Length - 1;
        var weights = TaskColumnWeights.Where((_, i) => showOrganization || i != TaskOrganizationColumn).Sum();
        return (contentWidth - durationWidth - TaskColumnSpacing * (columns - 1)) * TaskColumnWeights[index] / weights;
    }

    /// <summary>Width for the longest duration text ("2501h 30m" in the bold total row); at least the "Duration" header's.</summary>
    private static float DurationColumnWidth(IEnumerable<double> durations, double totalHours)
    {
        var longestRow = durations.Select(DurationText).DefaultIfEmpty("").MaxBy(text => text.Length)!;
        var longest = Math.Max(ReportFonts.EstimateWidth(longestRow, 8), ReportFonts.EstimateWidth(DurationText(totalHours), 8, bold: true));
        return Math.Max(ReportFonts.EstimateWidth("Duration", 7.5f), longest) + 1;
    }

    /// <summary>A duration that never wraps: "1h 30m" with a no-break space.</summary>
    private static string DurationText(double hours) => ReportFormatting.Duration(hours).Replace(' ', ' ');

    /// <summary>
    /// A creator name. An email address too wide for the column is split after its "@" ("someone@" / "example.com")
    /// instead of mid-word, and a part still too wide ends with an ellipsis. Display names wrap at spaces (2 lines).
    /// </summary>
    private static void NameCell(IContainer cell, string name, float width)
    {
        var at = name.IndexOf('@');
        if (at > 0 && at < name.Length - 1 && !name.Any(char.IsWhiteSpace) && ReportFonts.EstimateWidth(name, 8) > width)
        {
            cell.Column(lines =>
            {
                lines.Item().Text(name[..(at + 1)]).ClampLines(1).FontColor(Secondary);
                lines.Item().Text(name[(at + 1)..]).ClampLines(1).FontColor(Secondary);
            });
            return;
        }

        cell.Text(name).ClampLines(2).FontColor(Secondary);
    }

    private static void TaskDayHeader(IContainer container, ReportTaskDay day, int shown, System.Globalization.CultureInfo culture)
    {
        container.Background(Tile).BorderBottom(0.5f).BorderColor(Rule).PaddingVertical(4).PaddingHorizontal(4).Text(text =>
        {
            text.Span(ReportFormatting.DayLabel(day.Day, culture)).Bold();
            text.Span($" · {ReportFormatting.Tasks(day.Tasks.Count, culture)} · {ReportFormatting.Duration(day.Hours)}")
                .FontColor(Secondary);
            if (shown < day.Tasks.Count)
            {
                // The list is capped inside this day.
                text.Span($" · {ReportFormatting.Count(shown, culture)} shown").Bold().FontColor(Accent);
            }
        });
    }

    private static void TaskRow(IContainer container, ReportTask task, ReportModel model, TaskTableLayout layout)
    {
        var culture = model.Culture;
        var zone = model.TimeZone;
        var marker = ReportTaskList.EndDayMarker(task, zone);
        // A time never wraps inside itself ("9:30 AM"); the range wraps at the dash or before the marker.
        string Time(DateTime local) => ReportFormatting.Time(local, culture).Replace(' ', ' ');
        var range = $"{Time(ReportTaskList.LocalStart(task, zone))} – {Time(ReportTaskList.LocalEnd(task, zone))}";
        var untitled = string.IsNullOrWhiteSpace(task.Title);

        container.BorderBottom(0.5f).BorderColor(Rule).PaddingVertical(3.5f)
            .DefaultTextStyle(style => style.FontSize(8))
            .Element(c => TaskColumns(c, layout,
                cell => cell.Text(text =>
                {
                    text.Span(range);
                    if (marker.Length > 0)
                    {
                        text.Span(" " + marker).FontSize(7).Bold().FontColor(Accent);
                    }
                }),
                cell => cell.AlignRight().Text(DurationText(task.DurationHours)),
                cell => cell.Text(untitled ? ReportTaskList.UntitledTask : task.Title).ClampLines(3)
                    .Italic(untitled).FontColor(untitled ? Muted : Ink),
                cell => cell.Row(category =>
                {
                    category.ConstantItem(8).AlignMiddle().Height(8).Svg(layout.Swatch(task.CategoryColor));
                    category.ConstantItem(4);
                    category.RelativeItem().Text(task.CategoryName).ClampLines(2);
                }),
                cell => cell.Text(task.TemplateTitle ?? "—").ClampLines(2)
                    .FontColor(task.TemplateTitle is null || task.TemplateTitle == ReportModelBuilder.DeletedTemplate ? Muted : Secondary),
                cell => cell.Text(task.OrganizationName ?? "").ClampLines(2).FontColor(Secondary),
                cell => NameCell(cell, task.CreatedByDisplayName, layout.CreatedByWidth)));
    }

    /// <summary>The whole range's count and hours (= the KPIs); says how many rows are shown when the list is capped.</summary>
    private static void TaskTotalRow(IContainer container, ReportModel model, int shown, TaskTableLayout layout)
    {
        var culture = model.Culture;
        var kpis = model.Kpis;
        var capped = shown < kpis.TaskCount;
        var summary = $"{(capped ? "All " : "")}{ReportFormatting.Tasks(kpis.TaskCount, culture)} · {ReportFormatting.Hours(kpis.TotalHours, culture)}";

        container.BorderTop(0.75f).BorderColor(Ink).PaddingVertical(4)
            .DefaultTextStyle(style => style.FontSize(8).Bold())
            .Element(c => TaskColumns(c, layout,
                cell => cell.Text("Total"),
                cell => cell.AlignRight().Text(DurationText(kpis.TotalHours)),
                cell => cell.Column(lines =>
                {
                    lines.Item().Text(summary);
                    if (capped)
                    {
                        lines.Item().Text($"{ReportFormatting.Count(shown, culture)} shown above").FontColor(Accent);
                    }
                }),
                _ => { },
                _ => { },
                _ => { },
                _ => { }));
    }

    private static void ComposeFooter(IContainer container, ReportModel model)
    {
        container.Column(column =>
        {
            column.Item().LineHorizontal(0.5f).LineColor(Rule);
            column.Item().PaddingTop(4).Row(row =>
            {
                row.RelativeItem().Column(left =>
                {
                    left.Item().Text(
                            "Generated by Time Planner on " +
                            ReportFormatting.GeneratedAt(model.GeneratedAtUtc, model.TimeZoneId, model.TimeZone, model.Culture))
                        .FontSize(7).FontColor(Muted);
                    left.Item().Text($"Document ID: {model.DocumentId}").FontSize(7).FontColor(Muted);
                });

                row.ConstantItem(90).AlignRight().AlignBottom().Text(text =>
                {
                    text.DefaultTextStyle(style => style.FontSize(7).FontColor(Muted));
                    text.Span("Page ");
                    text.CurrentPageNumber();
                    text.Span(" of ");
                    text.TotalPages();
                });
            });
        });
    }

    private static void SectionTitle(IContainer container, string title) =>
        container.Text(title).FontSize(11).Bold();

    private static IContainer HeaderCell(IContainer container) =>
        container.BorderBottom(0.75f).BorderColor(Rule).PaddingVertical(4)
            .DefaultTextStyle(style => style.FontSize(7.5f).FontColor(Muted));

    // AlignMiddle: a cell whose text uses a taller fallback font (e.g. CJK) stays centred with its neighbours.
    private static IContainer BodyCell(IContainer container) =>
        container.BorderBottom(0.5f).BorderColor(Rule).PaddingVertical(4).AlignMiddle();

    private static string SubjectLine(ReportModel model) => model.Kind switch
    {
        ReportKind.Organization => $"Organization report · {model.SubjectName}",
        ReportKind.Member => $"Member report · {model.SubjectName}" + (model.OrganizationName is null ? "" : $" · {model.OrganizationName}"),
        _ => $"Personal report · {model.SubjectName}"
    };

    private static string ViewLabel(ReportSelection selection) =>
        selection.IsMonthly ? "By month" : selection.IsWeekly ? "By week" : "By day";

    private static string PeriodNoun(ReportSelection selection) =>
        selection.IsMonthly ? "month" : selection.IsWeekly ? "week" : "day";
}
