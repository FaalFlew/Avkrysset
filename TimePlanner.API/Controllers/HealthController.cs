using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace TimePlanner.API.Controllers;

/// <summary>
/// A cheap liveness ping: the client calls it to start waking the API (cold start) before the user acts.
/// Anonymous, not rate limited, no database access and never cached.
/// </summary>
[ApiController]
[Route("api/health")]
[AllowAnonymous]
[DisableRateLimiting]
public sealed class HealthController : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public IActionResult Get()
    {
        // A cached answer would not reach (and so not wake) the server.
        Response.Headers.CacheControl = "no-store";
        return NoContent();
    }
}
