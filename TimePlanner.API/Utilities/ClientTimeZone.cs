namespace TimePlanner.API.Utilities;

/// <summary>
/// Reads the caller's IANA time zone from the "X-Time-Zone" request header.
/// The zone is only used to group data into the caller's calendar days, weeks, months and years;
/// instants themselves are always UTC. A missing or malformed header yields null (meaning UTC).
/// </summary>
public static class ClientTimeZone
{
    public const string HeaderName = "X-Time-Zone";
    public const int MaxLength = 64;

    public static string? GetId(HttpRequest request)
    {
        if (!request.Headers.TryGetValue(HeaderName, out var values))
        {
            return null;
        }

        // Several header values are joined with commas, which IsWellFormed rejects.
        var id = values.ToString().Trim();
        return IsWellFormed(id) ? id : null;
    }

    /// <summary>A well-formed id that this server can resolve (used to validate stored organization zones).</summary>
    public static bool IsKnown(string? id) => IsWellFormed(id) && TimeZoneResolver.TryResolve(id, out _);

    public static bool IsWellFormed(string? id)
    {
        if (string.IsNullOrEmpty(id) || id.Length > MaxLength)
        {
            return false;
        }

        foreach (var c in id)
        {
            if (!char.IsAsciiLetterOrDigit(c) && c is not ('_' or '+' or '-' or '/'))
            {
                return false;
            }
        }

        return true;
    }
}
