using System.Globalization;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Reports;

/// <summary>
/// What the analytics page shows, as sent by the client (the server resolves the dates in the right zone):
/// monthly = calendar <see cref="Year"/>, months <see cref="From"/>..<see cref="To"/> as 0-based indexes 0-11;
/// weekly = ISO week-year <see cref="Year"/>, ISO weeks From..To;
/// daily = ISO week-year Year, From == To = the week (one bucket per day).
/// </summary>
/// <param name="View">"monthly", "weekly" or "daily" (lower case).</param>
public sealed record ReportSelection(string View, int Year, int From, int To)
{
    public const int MinYear = 1900;
    public const int MaxYear = 2200;
    public static readonly TimeSpan MaxSpan = TimeSpan.FromDays(400);

    public bool IsMonthly => View == TaskAnalyticsBreakdown.Monthly;
    public bool IsWeekly => View == TaskAnalyticsBreakdown.Weekly;
    public bool IsDaily => View == TaskAnalyticsBreakdown.Daily;

    /// <summary>
    /// Validates the raw query values. Returns the selection, or null with one message per problem.
    /// </summary>
    public static ReportSelection? TryCreate(string? view, int? year, int? from, int? to, out List<string> errors)
    {
        errors = new List<string>();

        if (!TaskAnalyticsBreakdown.IsSupportedViewType(view))
        {
            errors.Add("view must be 'monthly', 'weekly' or 'daily'.");
        }

        if (year is null)
        {
            errors.Add("year is required.");
        }
        else if (year < MinYear || year > MaxYear)
        {
            errors.Add($"year must be between {MinYear} and {MaxYear}.");
        }

        if (from is null)
        {
            errors.Add("from is required.");
        }

        if (to is null)
        {
            errors.Add("to is required.");
        }

        if (errors.Count > 0)
        {
            return null;
        }

        var selection = new ReportSelection(view!.ToLowerInvariant(), year!.Value, from!.Value, to!.Value);
        errors.AddRange(selection.Problems());
        return errors.Count == 0 ? selection : null;
    }

    private IEnumerable<string> Problems()
    {
        if (IsMonthly)
        {
            if (From is < 0 or > 11 || To is < 0 or > 11)
            {
                yield return "For the monthly view, from and to are month indexes from 0 (January) to 11 (December).";
            }
        }
        else
        {
            var weeks = ISOWeek.GetWeeksInYear(Year);
            if (From < 1 || From > weeks || To < 1 || To > weeks)
            {
                yield return $"from and to must be ISO weeks from 1 to {weeks} of {Year}.";
            }

            if (IsDaily && From != To)
            {
                yield return "For the daily view, from and to must be the same week.";
            }
        }

        if (From > To)
        {
            yield return "from must not be after to.";
        }
    }

    /// <summary>First and last local calendar day of the selection (inclusive).</summary>
    public (DateTime FirstDay, DateTime LastDay) LocalDays()
    {
        if (IsMonthly)
        {
            var first = new DateTime(Year, From + 1, 1);
            var last = new DateTime(Year, To + 1, 1).AddMonths(1).AddDays(-1);
            return (first, last);
        }

        return (ISOWeek.ToDateTime(Year, From, DayOfWeek.Monday), ISOWeek.ToDateTime(Year, To, DayOfWeek.Sunday));
    }

    /// <summary>The half-open UTC range [start, end) covered by the selection in <paramref name="timeZone"/>.</summary>
    public (DateTime StartUtc, DateTime EndUtc) Resolve(TimeZoneInfo timeZone)
    {
        var (firstDay, lastDay) = LocalDays();
        return (ZonedTime.ToUtc(firstDay, timeZone), ZonedTime.ToUtc(lastDay.AddDays(1), timeZone));
    }
}
