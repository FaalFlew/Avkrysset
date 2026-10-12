using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace TimePlanner.API.Data.Converters;

/// <summary>
/// Every DateTime column holds a UTC instant. SQL Server's datetime2 has no notion of
/// DateTimeKind, so without this converter values are materialized as Unspecified and
/// System.Text.Json writes them without a 'Z' (clients then read them as local time).
/// </summary>
public sealed class UtcDateTimeValueConverter : ValueConverter<DateTime, DateTime>
{
    public UtcDateTimeValueConverter() : base(
        v => v.Kind == DateTimeKind.Local ? v.ToUniversalTime() : v, // never store server-local wall time
        v => DateTime.SpecifyKind(v, DateTimeKind.Utc))               // always read back as UTC
    {
    }
}
