using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace TimePlanner.API.Features.Reports;

/// <summary>
/// Hand-written SVG for the PDF charts (drawn by QuestPDF's <c>Svg(size => …)</c>). The SVGs contain shapes only;
/// all text (axis labels, legends) is laid out by QuestPDF so it gets font fallback, shaping and RTL.
/// </summary>
public static partial class ReportCharts
{
    public const string NeutralColor = "#CBD2D9";
    public const string GridColor = "#E4E7EB";
    public const string AxisColor = "#9AA5B1";

    /// <summary>Number of gridline intervals of the bar chart's value axis.</summary>
    public const int AxisIntervals = 4;

    /// <summary>A slice of the donut chart.</summary>
    public sealed record Slice(double Value, string? Color);

    /// <summary>
    /// A "nice" axis for values up to <paramref name="maxValue"/>: the step is 1, 2, 2.5 or 5 × 10^n and the
    /// axis maximum is <see cref="AxisIntervals"/> steps. Empty data gets 0–4.
    /// </summary>
    public static (double Max, double Step) NiceAxis(double maxValue)
    {
        if (!double.IsFinite(maxValue) || maxValue <= 0)
        {
            return (AxisIntervals, 1);
        }

        var raw = maxValue / AxisIntervals;
        var magnitude = Math.Pow(10, Math.Floor(Math.Log10(raw)));
        var step = new[] { 1, 2, 2.5, 5, 10 }.Select(m => m * magnitude).First(s => s >= raw * (1 - 1e-9));
        return (step * AxisIntervals, step);
    }

    /// <summary>Vertical bars, one per value, in equal slots across <paramref name="width"/>, with horizontal gridlines.</summary>
    public static string BarChart(IReadOnlyList<(double Value, string? Color)> bars, double axisMax, float width, float height)
    {
        var svg = Open(width, height);

        for (var i = 0; i <= AxisIntervals; i++)
        {
            var y = Math.Round(height * i / AxisIntervals, 2);
            if (i == AxisIntervals)
            {
                y -= 0.4; // keep the baseline's stroke inside the image
            }

            svg.Append(Invariant($"<line x1=\"0\" y1=\"{y}\" x2=\"{width}\" y2=\"{y}\" stroke=\"{(i == AxisIntervals ? AxisColor : GridColor)}\" stroke-width=\"{(i == AxisIntervals ? 0.8 : 0.5)}\"/>"));
        }

        if (bars.Count > 0 && axisMax > 0)
        {
            var slot = width / (double)bars.Count;
            var barWidth = Math.Min(slot * 0.66, 28);
            var radius = Math.Min(2.5, barWidth / 2);
            for (var i = 0; i < bars.Count; i++)
            {
                var value = double.IsFinite(bars[i].Value) ? Math.Max(0, bars[i].Value) : 0;
                if (value <= 0)
                {
                    continue;
                }

                var barHeight = Math.Max(1, Math.Min(1, value / axisMax) * (height - 1));
                var x = i * slot + (slot - barWidth) / 2;
                var top = height - barHeight;
                var r = Math.Min(radius, barHeight);
                svg.Append(Invariant($"<path d=\"M{x:0.##},{height:0.##} L{x:0.##},{top + r:0.##} Q{x:0.##},{top:0.##} {x + r:0.##},{top:0.##} "))
                    .Append(Invariant($"L{x + barWidth - r:0.##},{top:0.##} Q{x + barWidth:0.##},{top:0.##} {x + barWidth:0.##},{top + r:0.##} "))
                    .Append(Invariant($"L{x + barWidth:0.##},{height:0.##} Z\" fill=\"{SafeColor(bars[i].Color)}\"/>"));
            }
        }

        return svg.Append("</svg>").ToString();
    }

    /// <summary>A ring chart, clockwise from 12 o'clock, with thin white gaps between slices.</summary>
    public static string Donut(IReadOnlyList<Slice> slices, float size, double thicknessRatio = 0.2)
    {
        var svg = Open(size, size);
        var cx = size / 2.0;
        var cy = size / 2.0;
        var outer = size / 2.0 - 1;
        var inner = outer * (1 - thicknessRatio * 2);
        var total = slices.Where(s => double.IsFinite(s.Value) && s.Value > 0).Sum(s => s.Value);

        if (total <= 0)
        {
            svg.Append(Invariant($"<circle cx=\"{cx:0.##}\" cy=\"{cy:0.##}\" r=\"{(outer + inner) / 2:0.##}\" fill=\"none\" stroke=\"{GridColor}\" stroke-width=\"{outer - inner:0.##}\"/>"));
            return svg.Append("</svg>").ToString();
        }

        var angle = -Math.PI / 2;
        foreach (var slice in slices)
        {
            if (!double.IsFinite(slice.Value) || slice.Value <= 0)
            {
                continue;
            }

            var fraction = slice.Value / total;
            var color = SafeColor(slice.Color);
            if (fraction >= 0.99999)
            {
                svg.Append(Invariant($"<circle cx=\"{cx:0.##}\" cy=\"{cy:0.##}\" r=\"{(outer + inner) / 2:0.##}\" fill=\"none\" stroke=\"{color}\" stroke-width=\"{outer - inner:0.##}\"/>"));
                break;
            }

            var end = angle + fraction * 2 * Math.PI;
            var large = fraction > 0.5 ? 1 : 0;
            var (ox0, oy0) = Point(cx, cy, outer, angle);
            var (ox1, oy1) = Point(cx, cy, outer, end);
            var (ix1, iy1) = Point(cx, cy, inner, end);
            var (ix0, iy0) = Point(cx, cy, inner, angle);
            svg.Append(Invariant($"<path d=\"M{ox0:0.###},{oy0:0.###} A{outer:0.###},{outer:0.###} 0 {large} 1 {ox1:0.###},{oy1:0.###} "))
                .Append(Invariant($"L{ix1:0.###},{iy1:0.###} A{inner:0.###},{inner:0.###} 0 {large} 0 {ix0:0.###},{iy0:0.###} Z\" "))
                .Append(Invariant($"fill=\"{color}\" stroke=\"#FFFFFF\" stroke-width=\"1\" stroke-linejoin=\"round\"/>"));
            angle = end;
        }

        return svg.Append("</svg>").ToString();
    }

    /// <summary>A small rounded square in <paramref name="color"/> (legend swatch).</summary>
    public static string Swatch(string? color, float size) =>
        Open(size, size).Append(Invariant(
            $"<rect x=\"0\" y=\"0\" width=\"{size}\" height=\"{size}\" rx=\"{size / 4:0.##}\" fill=\"{SafeColor(color)}\"/></svg>")).ToString();

    /// <summary>Colors come from user data and are written into SVG markup: only #rgb/#rrggbb(aa) pass, others become neutral.</summary>
    public static string SafeColor(string? color) =>
        color is not null && HexColor().IsMatch(color) ? color : NeutralColor;

    private static StringBuilder Open(float width, float height) =>
        new StringBuilder().Append(Invariant(
            $"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\">"));

    private static (double X, double Y) Point(double cx, double cy, double radius, double angle) =>
        (cx + radius * Math.Cos(angle), cy + radius * Math.Sin(angle));

    private static string Invariant(FormattableString text) => text.ToString(CultureInfo.InvariantCulture);

    [GeneratedRegex("^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$", RegexOptions.CultureInvariant)]
    private static partial Regex HexColor();
}
