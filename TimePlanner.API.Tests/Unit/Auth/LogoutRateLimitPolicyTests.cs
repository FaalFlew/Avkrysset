using System.Net;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using TimePlanner.API.Features.Commands.Auth;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Tests.Unit.Auth;

/// <summary>The per-IP fixed window on POST /api/auth/logout and its 429 response.</summary>
public sealed class LogoutRateLimitPolicyTests
{
    private static HttpContext From(string? ip)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = ip is null ? null : IPAddress.Parse(ip);
        return context;
    }

    private static bool Acquire(PartitionedRateLimiter<HttpContext> limiter, string? ip)
    {
        using var lease = limiter.AttemptAcquire(From(ip));
        return lease.IsAcquired;
    }

    private static async Task<(HttpContext Context, JsonDocument Body)> RunAsync(
        Func<HttpContext, ValueTask> write)
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        await write(context);
        context.Response.Body.Position = 0;
        return (context, await JsonDocument.ParseAsync(context.Response.Body));
    }

    [Fact]
    public void Each_client_ip_has_its_own_window_of_20_by_default()
    {
        using var limiter = PartitionedRateLimiter.Create<HttpContext, string>(
            new LogoutRateLimitPolicy(new LogoutRateLimitOptions()).GetPartition);

        for (var i = 0; i < 20; i++)
        {
            Assert.True(Acquire(limiter, "203.0.113.7"), $"request {i + 1}");
        }

        using (var rejected = limiter.AttemptAcquire(From("203.0.113.7")))
        {
            Assert.False(rejected.IsAcquired);
            Assert.True(rejected.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter));
            Assert.InRange(retryAfter, TimeSpan.FromSeconds(1), TimeSpan.FromMinutes(1));
        }

        // The same client seen as IPv4-mapped IPv6 shares the window; other clients have their own.
        Assert.False(Acquire(limiter, "::ffff:203.0.113.7"));
        Assert.True(Acquire(limiter, "203.0.113.8"));
        Assert.True(Acquire(limiter, "2001:db8::7"));
        Assert.True(Acquire(limiter, null));
    }

    [Fact]
    public void The_limit_is_configurable_and_at_least_one()
    {
        using var three = PartitionedRateLimiter.Create<HttpContext, string>(
            new LogoutRateLimitPolicy(new LogoutRateLimitOptions { LogoutPermitsPerMinute = 3 }).GetPartition);
        Assert.Equal(new[] { true, true, true, false }, Enumerable.Range(0, 4).Select(_ => Acquire(three, "198.51.100.1")));

        using var zero = PartitionedRateLimiter.Create<HttpContext, string>(
            new LogoutRateLimitPolicy(new LogoutRateLimitOptions { LogoutPermitsPerMinute = 0 }).GetPartition);
        Assert.Equal(new[] { true, false }, Enumerable.Range(0, 2).Select(_ => Acquire(zero, "198.51.100.1")));
    }

    [Theory]
    [InlineData("203.0.113.7", "ip:203.0.113.7")]
    [InlineData("::ffff:203.0.113.7", "ip:203.0.113.7")]
    [InlineData("2001:db8::7", "ip:2001:db8::7")]
    [InlineData(null, "ip:unknown")]
    public void The_partition_key_is_the_client_ip(string? ip, string key)
    {
        Assert.Equal(key, LogoutRateLimitPolicy.ClientKey(From(ip)));
    }

    [Fact]
    public async Task A_rejection_is_429_with_retry_after_and_the_usual_error_body()
    {
        var policy = new LogoutRateLimitPolicy(new LogoutRateLimitOptions { LogoutPermitsPerMinute = 1 });
        using var limiter = PartitionedRateLimiter.Create<HttpContext, string>(policy.GetPartition);
        Assert.True(Acquire(limiter, "203.0.113.9"));
        using var rejected = limiter.AttemptAcquire(From("203.0.113.9"));
        Assert.False(rejected.IsAcquired);

        var (context, body) = await RunAsync(c =>
            policy.OnRejected!(new OnRejectedContext { HttpContext = c, Lease = rejected }, CancellationToken.None));

        using (body)
        {
            var retryAfter = int.Parse(context.Response.Headers.RetryAfter.ToString());
            Assert.InRange(retryAfter, 1, 60);
            Assert.Equal(StatusCodes.Status429TooManyRequests, context.Response.StatusCode);
            Assert.Equal("no-store", context.Response.Headers.CacheControl.ToString());
            Assert.Equal("application/json", context.Response.ContentType);
            Assert.Equal($"Too many sign-out requests. Please try again in {retryAfter} second{(retryAfter == 1 ? "" : "s")}.",
                body.RootElement.GetProperty("message").GetString());
            Assert.Empty(body.RootElement.GetProperty("errors").EnumerateArray());
        }
    }

    [Theory]
    [InlineData(0, "1", "Slow down. Please try again in 1 second.")]
    [InlineData(1, "1", "Slow down. Please try again in 1 second.")]
    [InlineData(42, "42", "Slow down. Please try again in 42 seconds.")]
    public async Task The_shared_rejection_writer_asks_for_at_least_one_second(int seconds, string header, string message)
    {
        var (context, body) = await RunAsync(c =>
            RateLimitRejection.WriteAsync(c.Response, seconds, "Slow down.", CancellationToken.None));

        using (body)
        {
            Assert.Equal(StatusCodes.Status429TooManyRequests, context.Response.StatusCode);
            Assert.Equal(header, context.Response.Headers.RetryAfter.ToString());
            Assert.Equal(message, body.RootElement.GetProperty("message").GetString());
            Assert.Empty(body.RootElement.GetProperty("errors").EnumerateArray());
        }
    }
}
