using TimePlanner.API.Features.Commands.Auth;

namespace TimePlanner.API.Tests.Unit;

public sealed class RegisterMigrationStartTests
{
    [Theory]
    [InlineData("2026-10-03T07:00:00.000Z")]
    [InlineData("2026-10-03T07:00:00Z")]
    [InlineData("2026-10-03T09:00:00+02:00")]
    [InlineData("2026-10-03T09:00:00.000+02:00")]
    [InlineData("2026-10-03T07:00:00")]    // no offset => UTC (frontend sends normalized UTC strings)
    [InlineData("2026-10-03 07:00:00")]
    public void Parses_to_the_utc_instant(string value)
    {
        Assert.True(RegisterCommandHandler.TryParseMigratedStart(value, out var start));

        Assert.Equal(DateTimeKind.Utc, start.Kind);
        Assert.Equal(new DateTime(2026, 10, 3, 7, 0, 0, DateTimeKind.Utc), start);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("garbage")]
    [InlineData("2026-13-45T07:00:00Z")]
    public void Rejects_unreadable_values_instead_of_throwing(string? value)
    {
        Assert.False(RegisterCommandHandler.TryParseMigratedStart(value, out _));
    }
}
