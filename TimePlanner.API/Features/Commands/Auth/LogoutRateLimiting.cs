using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Auth;

/// <summary>Configuration section "Auth:RateLimit".</summary>
public sealed class LogoutRateLimitOptions
{
    public const string Section = "Auth:RateLimit";

    /// <summary>Per client IP: this many sign-out requests in each fixed one-minute window.</summary>
    public int LogoutPermitsPerMinute { get; set; } = 20;
}

/// <summary>
/// POST /api/auth/logout is anonymous (it must work with an expired access token) and may look a user up by refresh
/// token, so it is limited per client IP with a fixed window (20 a minute by default). Rejections are 429 with
/// Retry-After (seconds) and the usual { message, errors } body. Used with [EnableRateLimiting(Name)].
/// </summary>
public sealed class LogoutRateLimitPolicy : IRateLimiterPolicy<string>
{
    public const string Name = "auth-logout";

    private readonly int _permitsPerMinute;

    public LogoutRateLimitPolicy(LogoutRateLimitOptions options)
    {
        _permitsPerMinute = Math.Max(1, options.LogoutPermitsPerMinute);
    }

    public Func<OnRejectedContext, CancellationToken, ValueTask>? OnRejected { get; } = (context, cancellationToken) =>
    {
        var seconds = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter)
            ? (int)Math.Ceiling(retryAfter.TotalSeconds)
            : 60;
        return RateLimitRejection.WriteAsync(context.HttpContext.Response, seconds, "Too many sign-out requests.",
            cancellationToken);
    };

    public RateLimitPartition<string> GetPartition(HttpContext httpContext) =>
        RateLimitPartition.GetFixedWindowLimiter(ClientKey(httpContext), _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = _permitsPerMinute,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        });

    /// <summary>The client's IP (after the forwarded-headers middleware); IPv4-mapped IPv6 counts as the IPv4 address.</summary>
    internal static string ClientKey(HttpContext httpContext)
    {
        var address = httpContext.Connection.RemoteIpAddress;
        if (address is null)
        {
            return "ip:unknown";
        }

        return "ip:" + (address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address).ToString();
    }
}

public static class LogoutRateLimiting
{
    public static IServiceCollection AddLogoutRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(LogoutRateLimitOptions.Section).Get<LogoutRateLimitOptions>()
                      ?? new LogoutRateLimitOptions();

        services.AddRateLimiter(limiter => limiter.AddPolicy(LogoutRateLimitPolicy.Name, new LogoutRateLimitPolicy(options)));
        return services;
    }
}
