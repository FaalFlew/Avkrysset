using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using TimePlanner.API.Utilities;
using TimeZoneConverter;

namespace TimePlanner.API.Tests.Unit;

public sealed class TimeZoneResolverTests
{
    public static TheoryData<string, DateTime, TimeSpan> KnownZones => new()
    {
        { "Europe/Oslo", new DateTime(2026, 1, 15, 12, 0, 0, DateTimeKind.Utc), TimeSpan.FromHours(1) },
        { "Europe/Oslo", new DateTime(2026, 7, 15, 12, 0, 0, DateTimeKind.Utc), TimeSpan.FromHours(2) },
        { "Asia/Kolkata", new DateTime(2026, 7, 15, 12, 0, 0, DateTimeKind.Utc), new TimeSpan(5, 30, 0) },
        { "Asia/Calcutta", new DateTime(2026, 7, 15, 12, 0, 0, DateTimeKind.Utc), new TimeSpan(5, 30, 0) },
        { "Asia/Kathmandu", new DateTime(2026, 7, 15, 12, 0, 0, DateTimeKind.Utc), new TimeSpan(5, 45, 0) },
        { "Asia/Katmandu", new DateTime(2026, 7, 15, 12, 0, 0, DateTimeKind.Utc), new TimeSpan(5, 45, 0) },
        { "Pacific/Chatham", new DateTime(2026, 1, 15, 12, 0, 0, DateTimeKind.Utc), new TimeSpan(13, 45, 0) },
        { "Pacific/Chatham", new DateTime(2026, 7, 15, 12, 0, 0, DateTimeKind.Utc), new TimeSpan(12, 45, 0) },
        { "Australia/Lord_Howe", new DateTime(2026, 1, 15, 12, 0, 0, DateTimeKind.Utc), TimeSpan.FromHours(11) },
        { "Australia/Lord_Howe", new DateTime(2026, 7, 15, 12, 0, 0, DateTimeKind.Utc), new TimeSpan(10, 30, 0) },
        { "Pacific/Kiritimati", new DateTime(2026, 7, 15, 12, 0, 0, DateTimeKind.Utc), TimeSpan.FromHours(14) },
        { "Pacific/Pago_Pago", new DateTime(2026, 7, 15, 12, 0, 0, DateTimeKind.Utc), TimeSpan.FromHours(-11) },
        { "America/New_York", new DateTime(2026, 1, 15, 12, 0, 0, DateTimeKind.Utc), TimeSpan.FromHours(-5) },
        { "America/St_Johns", new DateTime(2026, 1, 15, 12, 0, 0, DateTimeKind.Utc), new TimeSpan(-3, -30, 0) },
        { "Etc/UTC", new DateTime(2026, 7, 15, 12, 0, 0, DateTimeKind.Utc), TimeSpan.Zero },
        { "UTC", new DateTime(2026, 7, 15, 12, 0, 0, DateTimeKind.Utc), TimeSpan.Zero },
    };

    [Theory]
    [MemberData(nameof(KnownZones))]
    public void Resolves_iana_ids_and_aliases_with_correct_offsets(string id, DateTime atUtc, TimeSpan expectedOffset)
    {
        Assert.True(TimeZoneResolver.TryResolve(id, out var zone));
        Assert.Equal(expectedOffset, zone!.GetUtcOffset(atUtc));
        Assert.Same(zone, TimeZoneResolver.ResolveOrUtc(id)); // cached
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Mars/Olympus_Mons")]
    [InlineData("garbage")]
    public void Unknown_ids_fall_back_to_utc(string? id)
    {
        Assert.False(TimeZoneResolver.TryResolve(id, out _));
        Assert.Same(TimeZoneInfo.Utc, TimeZoneResolver.ResolveOrUtc(id));
    }

    [Fact]
    public void Unknown_ids_are_remembered_and_warned_about_once()
    {
        var id = $"Nowhere/Zone_{Guid.NewGuid():N}"; // unique, so no other test has cached it
        var logger = new CountingLogger();
        Assert.False(TimeZoneResolver.IsCachedAsUnknown(id));

        for (var i = 0; i < 3; i++)
        {
            Assert.Same(TimeZoneInfo.Utc, TimeZoneResolver.ResolveOrUtc(id, logger));
            // After the first miss the id is answered from the negative cache.
            Assert.True(TimeZoneResolver.IsCachedAsUnknown(id));
        }

        Assert.False(TimeZoneResolver.TryResolve(id, out _));
        Assert.Equal(1, logger.Warnings);
    }

    [Theory]
    [InlineData("Europe/Oslo")]
    [InlineData("Asia/Calcutta")]
    [InlineData("Pacific/Kiritimati")]
    public void Known_ids_are_never_cached_as_unknown(string id)
    {
        var logger = new CountingLogger();

        Assert.NotSame(TimeZoneInfo.Utc, TimeZoneResolver.ResolveOrUtc(id, logger));
        Assert.True(TimeZoneResolver.TryResolve(id, out _));
        Assert.False(TimeZoneResolver.IsCachedAsUnknown(id));
        Assert.Equal(0, logger.Warnings);
    }

    private sealed class CountingLogger : ILogger
    {
        private int _warnings;

        public int Warnings => _warnings;

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (logLevel == LogLevel.Warning)
            {
                Interlocked.Increment(ref _warnings);
            }
        }
    }

    [Theory]
    [InlineData("Europe/Oslo")]
    [InlineData("Asia/Calcutta")]
    [InlineData("Asia/Katmandu")]
    [InlineData("Australia/Lord_Howe")]
    public void TimeZoneConverter_fallback_knows_the_ids_even_without_os_lookup(string id)
    {
        // Last-resort path in TimeZoneResolver for hosts where ICU is unavailable.
        Assert.True(TZConvert.TryGetTimeZoneInfo(id, out var zone));
        Assert.NotNull(zone);
    }

    [Theory]
    [InlineData("Europe/Oslo", "Europe/Oslo")]
    [InlineData("  America/Argentina/Buenos_Aires ", "America/Argentina/Buenos_Aires")]
    [InlineData("Etc/GMT+5", "Etc/GMT+5")]
    [InlineData("America/Port-au-Prince", "America/Port-au-Prince")]
    [InlineData("Europe/Oslo; DROP TABLE", null)]
    [InlineData("W. Europe Standard Time", null)]
    [InlineData("Europe/Oslo,Asia/Kolkata", null)]
    [InlineData("", null)]
    public void Client_time_zone_header_is_validated(string header, string? expected)
    {
        var context = new DefaultHttpContext();
        context.Request.Headers[ClientTimeZone.HeaderName] = header;

        Assert.Equal(expected, ClientTimeZone.GetId(context.Request));
    }

    [Fact]
    public void Client_time_zone_header_is_optional_and_length_limited()
    {
        var missing = new DefaultHttpContext();
        Assert.Null(ClientTimeZone.GetId(missing.Request));

        var tooLong = new DefaultHttpContext();
        tooLong.Request.Headers[ClientTimeZone.HeaderName] = new string('A', ClientTimeZone.MaxLength + 1);
        Assert.Null(ClientTimeZone.GetId(tooLong.Request));

        var twoValues = new DefaultHttpContext();
        twoValues.Request.Headers[ClientTimeZone.HeaderName] = new[] { "Europe/Oslo", "Asia/Kolkata" };
        Assert.Null(ClientTimeZone.GetId(twoValues.Request));
    }
}
