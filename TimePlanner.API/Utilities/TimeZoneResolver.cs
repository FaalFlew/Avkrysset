using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using System.Security;
using TimeZoneConverter;

namespace TimePlanner.API.Utilities;

/// <summary>
/// Resolves IANA time zone ids (including legacy aliases such as "Asia/Calcutta" or
/// "Asia/Katmandu") to a <see cref="TimeZoneInfo"/>. Lookup order:
/// 1. the OS/ICU lookup, 2. IANA to Windows id via ICU, 3. the TimeZoneConverter mapping
/// tables (works even when ICU is unavailable). Unknown ids fall back to UTC.
/// </summary>
public static class TimeZoneResolver
{
    // Upper bound for each cache so arbitrary client-supplied ids cannot grow memory without limit.
    private const int MaxCacheEntries = 1024;

    private static readonly ConcurrentDictionary<string, TimeZoneInfo> Resolved = new(StringComparer.Ordinal);
    // Ids that failed every lookup, so a repeated bogus header costs one dictionary hit instead of three lookups.
    private static readonly ConcurrentDictionary<string, byte> Unresolvable = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, byte> WarnedIds = new(StringComparer.Ordinal);

    public static bool TryResolve(string? id, [NotNullWhen(true)] out TimeZoneInfo? timeZone)
    {
        timeZone = null;
        if (string.IsNullOrWhiteSpace(id))
        {
            return false;
        }

        if (Resolved.TryGetValue(id, out timeZone))
        {
            return true;
        }

        if (Unresolvable.ContainsKey(id))
        {
            return false;
        }

        timeZone = FindUncached(id);
        if (timeZone is null)
        {
            if (Unresolvable.Count < MaxCacheEntries)
            {
                Unresolvable.TryAdd(id, 0);
            }

            return false;
        }

        if (Resolved.Count < MaxCacheEntries)
        {
            Resolved.TryAdd(id, timeZone);
        }

        return true;
    }

    /// <summary>
    /// Returns the zone for <paramref name="id"/>, or UTC when the id is missing or unknown.
    /// An unknown id is logged once.
    /// </summary>
    public static TimeZoneInfo ResolveOrUtc(string? id, ILogger? logger = null)
    {
        if (TryResolve(id, out var timeZone))
        {
            return timeZone;
        }

        if (!string.IsNullOrWhiteSpace(id) && WarnedIds.Count < MaxCacheEntries && WarnedIds.TryAdd(id, 0))
        {
            logger?.LogWarning("Unknown time zone id '{TimeZoneId}'. Falling back to UTC.", id);
        }

        return TimeZoneInfo.Utc;
    }

    // For tests: whether an id is remembered as unknown (answered without repeating the lookups).
    internal static bool IsCachedAsUnknown(string id) => Unresolvable.ContainsKey(id);

    private static TimeZoneInfo? FindUncached(string id)
    {
        try
        {
            if (TimeZoneInfo.TryFindSystemTimeZoneById(id, out var timeZone))
            {
                return timeZone;
            }

            if (TimeZoneInfo.TryConvertIanaIdToWindowsId(id, out var windowsId)
                && TimeZoneInfo.TryFindSystemTimeZoneById(windowsId, out timeZone))
            {
                return timeZone;
            }

            if (TZConvert.TryGetTimeZoneInfo(id, out timeZone))
            {
                return timeZone;
            }
        }
        catch (Exception ex) when (ex is InvalidTimeZoneException or ArgumentException or SecurityException)
        {
            // Corrupt OS time zone data or an id the OS refuses to look up: treat as unknown.
        }

        return null;
    }
}
