using System.Collections.Concurrent;
using System.Globalization;

namespace TimePlanner.API.Features.Reports;

/// <summary>Culture, paper size and CSV number style for a BCP-47 locale sent by the client.</summary>
public static class ReportLocale
{
    private const int MaxLocaleLength = 64;

    /// <summary>
    /// Regions that use US Letter (CLDR paper size data); everything else gets A4.
    /// The frontend (src/lib/paper.ts) uses the same list.
    /// </summary>
    public static readonly IReadOnlySet<string> LetterRegions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "US", "CA", "MX", "PH", "CL", "CO", "VE", "GT", "CR", "PA", "DO", "PR", "SV", "NI", "BZ"
    };

    /// <summary>The culture for <paramref name="locale"/>, or the invariant culture when it is missing or unknown.</summary>
    public static CultureInfo CultureFor(string? locale)
    {
        if (!IsWellFormed(locale))
        {
            return CultureInfo.InvariantCulture;
        }

        try
        {
            // predefinedOnly: an unknown tag must not silently become a made-up culture with invariant data.
            return CultureInfo.GetCultureInfo(locale!, predefinedOnly: true);
        }
        catch (CultureNotFoundException)
        {
            return CultureInfo.InvariantCulture;
        }
    }

    /// <summary>
    /// The culture used to format the report's dates and numbers: <paramref name="culture"/> on the Gregorian
    /// calendar (bucket keys, ISO weeks and month indexes are Gregorian; e.g. ar-SA defaults to Umm al-Qura), or the
    /// invariant culture when the culture has no Gregorian calendar or the report fonts can't draw its month and day
    /// names, date/time literals or number symbols (e.g. Thai, Devanagari), so dates never render as blanks.
    /// </summary>
    public static CultureInfo FormattingCultureFor(CultureInfo culture)
    {
        if (string.IsNullOrEmpty(culture.Name))
        {
            return culture;
        }

        if (FormattingCultures.TryGetValue(culture.Name, out var cached))
        {
            return cached;
        }

        var formatting = GregorianOrNull(culture) is { } gregorian && CanDraw(gregorian)
            ? gregorian
            : CultureInfo.InvariantCulture;
        if (FormattingCultures.Count < 1024)
        {
            FormattingCultures.TryAdd(culture.Name, formatting);
        }

        return formatting;
    }

    private static readonly ConcurrentDictionary<string, CultureInfo> FormattingCultures = new(StringComparer.Ordinal);

    private static CultureInfo? GregorianOrNull(CultureInfo culture)
    {
        if (culture.DateTimeFormat.Calendar is GregorianCalendar)
        {
            return culture;
        }

        var gregorian = culture.OptionalCalendars.OfType<GregorianCalendar>().FirstOrDefault();
        if (gregorian is null)
        {
            return null;
        }

        var clone = (CultureInfo)culture.Clone();
        clone.DateTimeFormat.Calendar = gregorian;
        return CultureInfo.ReadOnly(clone);
    }

    private static bool CanDraw(CultureInfo culture)
    {
        var dates = culture.DateTimeFormat;
        var numbers = culture.NumberFormat;
        var sample = new DateTime(2026, 12, 28, 21, 45, 0);
        var texts = dates.MonthNames
            .Concat(dates.MonthGenitiveNames)
            .Concat(dates.AbbreviatedMonthNames)
            .Concat(dates.AbbreviatedMonthGenitiveNames)
            .Concat(dates.DayNames)
            .Concat(dates.AbbreviatedDayNames)
            .Concat(new[]
            {
                dates.AMDesignator, dates.PMDesignator,
                sample.ToString("D", culture), sample.ToString("Y", culture), sample.ToString("d", culture), sample.ToString("g", culture),
                numbers.NumberDecimalSeparator, numbers.NumberGroupSeparator, numbers.PercentSymbol, numbers.NegativeSign,
                1234.5.ToString("#,##0.#", culture), 0.25.ToString("P0", culture), 1234.ToString("N0", culture)
            });

        return ReportFonts.MissingCodePoints(texts, max: 1).Count == 0;
    }

    /// <summary>Parses "A4" / "Letter" (case-insensitive). Null or empty means "not given".</summary>
    public static bool TryParsePaper(string? value, out PaperSize? paper)
    {
        paper = null;
        if (string.IsNullOrWhiteSpace(value))
        {
            return true;
        }

        if (string.Equals(value.Trim(), "A4", StringComparison.OrdinalIgnoreCase))
        {
            paper = PaperSize.A4;
            return true;
        }

        if (string.Equals(value.Trim(), "Letter", StringComparison.OrdinalIgnoreCase))
        {
            paper = PaperSize.Letter;
            return true;
        }

        return false;
    }

    /// <summary>Letter for the regions in <see cref="LetterRegions"/> (region taken from the most likely specific culture), else A4.</summary>
    public static PaperSize PaperFor(CultureInfo culture)
    {
        var region = RegionOf(culture);
        return region is not null && LetterRegions.Contains(region) ? PaperSize.Letter : PaperSize.A4;
    }

    /// <summary>Two-letter region of the culture ("en" counts as "en-US"); null for the invariant culture.</summary>
    public static string? RegionOf(CultureInfo culture)
    {
        if (string.IsNullOrEmpty(culture.Name))
        {
            return null;
        }

        try
        {
            var specific = culture.IsNeutralCulture ? CultureInfo.CreateSpecificCulture(culture.Name) : culture;
            return string.IsNullOrEmpty(specific.Name) ? null : new RegionInfo(specific.Name).TwoLetterISORegionName;
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    /// <summary>
    /// CSV style (§8 Q10): locales whose decimal separator is a comma get ';' as delimiter and ',' as decimal
    /// separator (so spreadsheet apps in those locales open the file correctly); all others get ',' and '.'.
    /// </summary>
    public static (char Delimiter, char DecimalSeparator) CsvStyleFor(CultureInfo culture) =>
        culture.NumberFormat.NumberDecimalSeparator == "," ? (';', ',') : (',', '.');

    private static bool IsWellFormed(string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale) || locale.Length > MaxLocaleLength)
        {
            return false;
        }

        foreach (var c in locale)
        {
            if (!char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))
            {
                return false;
            }
        }

        return true;
    }
}
