using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TimePlanner.API.Utilities.Json;

/// <summary>
/// Wire format for every DateTime in the API: a UTC instant written exactly like
/// JavaScript's Date.prototype.toISOString(), e.g. "2026-10-03T07:00:00.000Z".
/// Reading: 'Z' is kept as UTC, an explicit offset is converted to UTC, and a value
/// without an offset is treated as UTC (lenient contract for older clients).
/// Registered for DateTime, it also handles DateTime? properties.
/// </summary>
public sealed class UtcDateTimeJsonConverter : JsonConverter<DateTime>
{
    public const string WireFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String)
        {
            throw new JsonException("Expected an ISO 8601 date-time string.");
        }

        if (!reader.TryGetDateTime(out var value))
        {
            throw new JsonException("The value is not a valid ISO 8601 date-time.");
        }

        return value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Unspecified => DateTime.SpecifyKind(value, DateTimeKind.Utc),
            // An explicit offset makes the reader return server-local time; go back to the exact instant.
            _ => reader.TryGetDateTimeOffset(out var withOffset) ? withOffset.UtcDateTime : value.ToUniversalTime()
        };
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(ToUtc(value).ToString(WireFormat, CultureInfo.InvariantCulture));
    }

    private static DateTime ToUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };
}
