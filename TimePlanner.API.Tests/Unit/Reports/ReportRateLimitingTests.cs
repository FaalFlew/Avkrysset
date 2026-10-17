using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http;
using TimePlanner.API.Features.Reports;

namespace TimePlanner.API.Tests.Unit.Reports;

/// <summary>The chained report limiter: global render slots first, then the per-user token bucket.</summary>
public sealed class ReportRateLimitingTests
{
    private static HttpContext Request(string userId, bool report = true)
    {
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId) }, "test"))
        };
        if (report)
        {
            context.SetEndpoint(new Endpoint(_ => Task.CompletedTask,
                new EndpointMetadataCollection(new ReportRenderingAttribute()), "report"));
        }

        return context;
    }

    [Fact]
    public void A_busy_rejection_does_not_use_the_users_tokens()
    {
        using var limiter = ReportRateLimiting.CreateGlobalLimiter(
            new ReportRateLimitOptions { PermitsPerMinute = 3, ConcurrentRenders = 2 });
        var first = limiter.AttemptAcquire(Request("a"));
        var second = limiter.AttemptAcquire(Request("b"));
        Assert.True(first.IsAcquired && second.IsAcquired);

        // Both render slots are taken: user c is turned away five times, as "busy" (no Retry-After from a bucket).
        for (var i = 0; i < 5; i++)
        {
            using var busy = limiter.AttemptAcquire(Request("c"));
            Assert.False(busy.IsAcquired);
            Assert.False(busy.TryGetMetadata(MetadataName.RetryAfter, out _));
        }

        first.Dispose();
        second.Dispose();

        // ...and still has all 3 tokens, then gets a "too many" rejection with Retry-After.
        for (var i = 0; i < 3; i++)
        {
            using var lease = limiter.AttemptAcquire(Request("c"));
            Assert.True(lease.IsAcquired, $"request {i + 1}");
        }

        using var tooMany = limiter.AttemptAcquire(Request("c"));
        Assert.False(tooMany.IsAcquired);
        Assert.True(tooMany.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter));
        Assert.InRange(retryAfter, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(20));
    }

    [Fact]
    public void A_user_without_tokens_does_not_keep_a_render_slot()
    {
        using var limiter = ReportRateLimiting.CreateGlobalLimiter(
            new ReportRateLimitOptions { PermitsPerMinute = 1, ConcurrentRenders = 1 });
        limiter.AttemptAcquire(Request("a")).Dispose();

        using var rejected = limiter.AttemptAcquire(Request("a"));
        Assert.False(rejected.IsAcquired);
        Assert.True(rejected.TryGetMetadata(MetadataName.RetryAfter, out _));

        // The only render slot was released again, so somebody else can render.
        using var other = limiter.AttemptAcquire(Request("b"));
        Assert.True(other.IsAcquired);
    }

    [Fact]
    public void Other_endpoints_are_never_limited()
    {
        using var limiter = ReportRateLimiting.CreateGlobalLimiter(
            new ReportRateLimitOptions { PermitsPerMinute = 1, ConcurrentRenders = 1 });
        using var render = limiter.AttemptAcquire(Request("a"));
        Assert.True(render.IsAcquired);

        for (var i = 0; i < 50; i++)
        {
            using var lease = limiter.AttemptAcquire(Request("a", report: false));
            Assert.True(lease.IsAcquired);
        }
    }
}
