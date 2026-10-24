using System.Security.Claims;
using System.Threading.RateLimiting;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Reports;

/// <summary>Marks endpoints that render reports; the report limiter applies only to them.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class ReportRenderingAttribute : Attribute
{
}

/// <summary>Configuration section "Reports:RateLimit".</summary>
public sealed class ReportRateLimitOptions
{
    public const string Section = "Reports:RateLimit";

    /// <summary>Per user: a bucket of this many requests, refilled at the same rate per minute.</summary>
    public int PermitsPerMinute { get; set; } = 10;

    /// <summary>Renders running at once across all users (PDF rendering is CPU and memory heavy on a 32-bit host).</summary>
    public int ConcurrentRenders { get; set; } = 4;

    /// <summary>Retry-After for requests rejected because all render slots are busy.</summary>
    public int BusyRetryAfterSeconds { get; set; } = 5;
}

/// <summary>
/// Rate limits for report endpoints: one global concurrency limit (4 renders) chained with a token bucket per
/// signed-in user (10 per minute, burst 10). Rejections are 429 with Retry-After (seconds) and the usual
/// { message, errors } body. Must run after authentication so the user is known.
/// </summary>
public static class ReportRateLimiting
{
    public static IServiceCollection AddReportRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(ReportRateLimitOptions.Section).Get<ReportRateLimitOptions>()
                      ?? new ReportRateLimitOptions();

        services.AddRateLimiter(limiter =>
        {
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            limiter.GlobalLimiter = CreateGlobalLimiter(options);

            // Rejections by the global limiter (reports). Endpoint policies such as the sign-out limit bring their own.
            limiter.OnRejected = (context, cancellationToken) =>
            {
                // Only the per-user bucket reports when a token comes back; a rejection without it means "busy".
                var tooMany = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter);
                var seconds = tooMany ? (int)Math.Ceiling(retryAfter.TotalSeconds) : options.BusyRetryAfterSeconds;
                return RateLimitRejection.WriteAsync(context.HttpContext.Response, seconds,
                    tooMany ? "Too many report requests." : "Reports are busy right now.", cancellationToken);
            };
        });

        return services;
    }

    /// <summary>
    /// The global render-concurrency limit comes first in the chain: when all render slots are busy the request is
    /// rejected before it reaches the user's bucket, so a "busy" 429 costs the user no token. When the user's
    /// bucket is empty, the render slot acquired a moment earlier is released again by the chain.
    /// Other endpoints get no limiter.
    /// </summary>
    internal static PartitionedRateLimiter<HttpContext> CreateGlobalLimiter(ReportRateLimitOptions options)
    {
        var permits = Math.Max(1, options.PermitsPerMinute);
        return PartitionedRateLimiter.CreateChained(
            PartitionedRateLimiter.Create<HttpContext, string>(context => IsReport(context)
                ? RateLimitPartition.GetConcurrencyLimiter("renders", _ => new ConcurrencyLimiterOptions
                {
                    PermitLimit = Math.Max(1, options.ConcurrentRenders),
                    QueueLimit = 0
                })
                : RateLimitPartition.GetNoLimiter(string.Empty)),
            PartitionedRateLimiter.Create<HttpContext, string>(context => IsReport(context)
                ? RateLimitPartition.GetTokenBucketLimiter("user:" + UserKey(context), _ => new TokenBucketRateLimiterOptions
                {
                    TokenLimit = permits,
                    TokensPerPeriod = 1,
                    ReplenishmentPeriod = TimeSpan.FromMinutes(1) / permits,
                    QueueLimit = 0,
                    AutoReplenishment = true
                })
                : RateLimitPartition.GetNoLimiter(string.Empty)));
    }

    private static bool IsReport(HttpContext context) =>
        context.GetEndpoint()?.Metadata.GetMetadata<ReportRenderingAttribute>() is not null;

    private static string UserKey(HttpContext context) =>
        context.User.FindFirstValue(ClaimTypes.NameIdentifier)
        ?? "ip:" + (context.Connection.RemoteIpAddress?.ToString() ?? "unknown");
}
