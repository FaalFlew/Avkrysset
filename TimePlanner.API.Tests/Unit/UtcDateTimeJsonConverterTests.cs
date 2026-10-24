using System.Text.Json;
using TimePlanner.API.Utilities.Json;

namespace TimePlanner.API.Tests.Unit;

public sealed class UtcDateTimeJsonConverterTests
{
    private static readonly JsonSerializerOptions Options = CreateOptions();

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        options.Converters.Add(new UtcDateTimeJsonConverter());
        return options;
    }

    [Theory]
    [InlineData("\"2026-10-03T07:00:00.000Z\"")]
    [InlineData("\"2026-10-03T07:00:00Z\"")]
    [InlineData("\"2026-10-03T09:00:00+02:00\"")]
    [InlineData("\"2026-10-03T09:00:00.000+02:00\"")]
    [InlineData("\"2026-10-03T01:30:00-05:30\"")]
    [InlineData("\"2026-10-03T07:00:00\"")] // no offset => UTC
    public void Read_returns_the_utc_instant(string json)
    {
        var value = JsonSerializer.Deserialize<DateTime>(json, Options);

        Assert.Equal(DateTimeKind.Utc, value.Kind);
        Assert.Equal(new DateTime(2026, 10, 3, 7, 0, 0, DateTimeKind.Utc), value);
    }

    [Fact]
    public void Read_keeps_sub_millisecond_precision()
    {
        var value = JsonSerializer.Deserialize<DateTime>("\"2026-10-03T07:00:00.1234567Z\"", Options);

        Assert.Equal(new DateTime(2026, 10, 3, 7, 0, 0, DateTimeKind.Utc).AddTicks(1234567), value);
    }

    [Theory]
    [InlineData("\"not a date\"")]
    [InlineData("\"2026-13-03T07:00:00Z\"")]
    [InlineData("\"\"")]
    [InlineData("\"2026-10-03 07:00:00\"")] // space separator is not ISO 8601 extended format
    [InlineData("1759474800000")]
    [InlineData("true")]
    public void Read_rejects_non_iso_values(string json)
    {
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<DateTime>(json, Options));
    }

    [Fact]
    public void Write_uses_the_javascript_toISOString_format()
    {
        var utc = new DateTime(2026, 10, 3, 7, 0, 0, DateTimeKind.Utc);
        var unspecified = DateTime.SpecifyKind(utc, DateTimeKind.Unspecified);

        Assert.Equal("\"2026-10-03T07:00:00.000Z\"", JsonSerializer.Serialize(utc, Options));
        Assert.Equal("\"2026-10-03T07:00:00.000Z\"", JsonSerializer.Serialize(unspecified, Options));
        Assert.Equal("\"0001-01-01T00:00:00.000Z\"", JsonSerializer.Serialize(default(DateTime), Options));
        Assert.Equal("\"2026-10-03T07:00:00.123Z\"", JsonSerializer.Serialize(utc.AddTicks(1239999), Options));
    }

    [Fact]
    public void Write_converts_local_time_to_utc()
    {
        var local = new DateTime(2026, 10, 3, 9, 0, 0, DateTimeKind.Local);
        var expected = local.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");

        Assert.Equal($"\"{expected}\"", JsonSerializer.Serialize(local, Options));
    }

    [Fact]
    public void Nullable_DateTime_properties_use_the_converter()
    {
        var json = JsonSerializer.Serialize(new Sample
        {
            When = new DateTime(2026, 10, 3, 7, 0, 0, DateTimeKind.Unspecified),
            Maybe = new DateTime(2026, 10, 3, 7, 0, 0, DateTimeKind.Unspecified),
            Missing = null
        }, Options);

        Assert.Equal(
            "{\"when\":\"2026-10-03T07:00:00.000Z\",\"maybe\":\"2026-10-03T07:00:00.000Z\",\"missing\":null}",
            json);

        var read = JsonSerializer.Deserialize<Sample>(
            "{\"when\":\"2026-10-03T09:00:00+02:00\",\"maybe\":\"2026-10-03T09:00:00+02:00\",\"missing\":null}",
            Options)!;

        Assert.Equal(new DateTime(2026, 10, 3, 7, 0, 0, DateTimeKind.Utc), read.When);
        Assert.Equal(DateTimeKind.Utc, read.Maybe!.Value.Kind);
        Assert.Equal(new DateTime(2026, 10, 3, 7, 0, 0, DateTimeKind.Utc), read.Maybe.Value);
        Assert.Null(read.Missing);
    }

    private sealed class Sample
    {
        public DateTime When { get; set; }
        public DateTime? Maybe { get; set; }
        public DateTime? Missing { get; set; }
    }
}
