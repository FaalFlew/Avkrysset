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
/// time per category (donut + table), time per template, and a footer with generation time, document ID and
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
        page.Margin(14, Unit.Millimetre);
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
