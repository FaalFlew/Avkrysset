namespace TimePlanner.API.Utilities;

/// <summary>
/// Converts wall-clock times of a time zone to UTC instants with the same rules as the frontend
/// (src/lib/datetime.ts): a time that doesn't exist (DST gap) moves forward by the length of the gap,
/// and a repeated time (DST overlap) takes the earlier occurrence.
/// The opposite direction is <c>TaskAnalyticsBreakdown.ToLocal</c>.
/// </summary>
public static class ZonedTime
{
    /// <summary>The UTC instant of the wall-clock time <paramref name="local"/> in <paramref name="timeZone"/>.</summary>
    public static DateTime ToUtc(DateTime local, TimeZoneInfo timeZone)
    {
        var wall = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);

        if (timeZone.IsInvalidTime(wall))
        {
            // Interpreted with the offset in force before the gap, the instant lands after the transition.
            var offsetBefore = timeZone.GetUtcOffset(wall.AddDays(-1));
            return DateTime.SpecifyKind(wall - offsetBefore, DateTimeKind.Utc);
        }

        if (timeZone.IsAmbiguousTime(wall))
        {
            // The earlier occurrence is the one with the larger offset (still on summer time).
            var offset = timeZone.GetAmbiguousTimeOffsets(wall).Max();
            return DateTime.SpecifyKind(wall - offset, DateTimeKind.Utc);
        }

        return TimeZoneInfo.ConvertTimeToUtc(wall, timeZone);
    }
}
