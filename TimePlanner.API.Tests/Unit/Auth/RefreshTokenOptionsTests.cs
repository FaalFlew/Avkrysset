using TimePlanner.API.Features.Commands.Auth;

namespace TimePlanner.API.Tests.Unit.Auth;

/// <summary>"Auth:RefreshTokenGraceSeconds": the window in which the replaced refresh token still gets the current pair.</summary>
public sealed class RefreshTokenOptionsTests
{
    [Fact]
    public void The_grace_period_is_two_minutes_by_default()
    {
        Assert.Equal(TimeSpan.FromMinutes(2), new RefreshTokenOptions().GracePeriod);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(-30, 0)]
    [InlineData(45, 45)]
    public void Zero_or_less_turns_the_grace_period_off(int configured, int seconds)
    {
        Assert.Equal(TimeSpan.FromSeconds(seconds), new RefreshTokenOptions { RefreshTokenGraceSeconds = configured }.GracePeriod);
    }
}
