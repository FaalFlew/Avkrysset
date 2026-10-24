using System.Globalization;
using System.Text.Json;

namespace TimePlanner.API.Utilities;

/// <summary>The response for a request turned away by a rate limiter: 429, Retry-After and the usual { message, errors }.</summary>
public static class RateLimitRejection
{
    /// <summary>
    /// Writes 429 with Retry-After (whole seconds, at least 1), Cache-Control: no-store and
    /// { "message": "{reason} Please try again in N second(s).", "errors": [] }.
    /// </summary>
    public static async ValueTask WriteAsync(HttpResponse response, int retryAfterSeconds, string reason,
        CancellationToken cancellationToken)
    {
        var seconds = Math.Max(1, retryAfterSeconds);
        var wait = $"{seconds} second{(seconds == 1 ? "" : "s")}";

        response.StatusCode = StatusCodes.Status429TooManyRequests;
        response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
        response.Headers.CacheControl = "no-store";
        response.ContentType = "application/json";
        await response.WriteAsync(JsonSerializer.Serialize(new
        {
            message = $"{reason} Please try again in {wait}.",
            errors = Array.Empty<string>()
        }), cancellationToken);
    }
}
