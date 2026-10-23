using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using TimePlanner.API.Data;
using TimePlanner.API.Models;

namespace TimePlanner.API.Tests.Integration;

/// <summary>
/// The cold-start logout race (docs/plans/auth-session-race.md): POST /api/auth/logout works without a valid access
/// token, GET /api/health, and the sign-out rate limit, end to end on LocalDB.
/// </summary>
[Collection(ApiCollection.Name)]
public sealed class AuthSessionApiTests
{
    private const string Origin = "http://localhost:5173";

    private readonly ApiFixture _fixture;

    public AuthSessionApiTests(ApiFixture fixture)
    {
        _fixture = fixture;
    }

    private sealed record Session(TestUser User, string AccessToken, string RefreshToken);

    private sealed record Stored(string? RefreshToken, DateTime ExpiryUtc, string? ConcurrencyStamp);

    /// <summary>A confirmed user signed in through /api/auth/login; the tokens are the current ones.</summary>
    private async Task<Session> SignInAsync()
    {
        var user = await _fixture.CreateUserAsync();
        var (access, refresh) = await LoginAsync(user.Email);
        return new Session(user, access, refresh);
    }

    private async Task<(string Access, string Refresh)> LoginAsync(string email) =>
        await ReadTokensAsync(await Client().PostAsJsonAsync("/api/auth/login", new { email, password = ApiFixture.Password }));

    private static async Task<(string Access, string Refresh)> ReadTokensAsync(HttpResponseMessage response)
    {
        var json = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == HttpStatusCode.OK, json);
        using var body = JsonDocument.Parse(json);
        return (body.RootElement.GetProperty("accessToken").GetString()!, body.RootElement.GetProperty("refreshToken").GetString()!);
    }

    /// <summary>A client with its own client IP, so the per-IP sign-out limit never carries over between tests.</summary>
    private HttpClient Client(string? bearer = null, string? ip = null)
    {
        var client = _fixture.Factory.CreateClient();
        client.DefaultRequestHeaders.TryAddWithoutValidation(TestClientIp.Header, ip ?? TestClientIp.Unique());
        if (bearer is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        }

        return client;
    }

    private Task<HttpResponseMessage> RefreshAsync(string refreshToken) =>
        Client().PostAsJsonAsync("/api/auth/refresh", new { refreshToken });

    /// <summary>POST /api/auth/logout; <paramref name="json"/> null sends no body at all.</summary>
    private static Task<HttpResponseMessage> LogoutAsync(HttpClient client, string? json, string? origin = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/logout");
        if (json is not null)
        {
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        if (origin is not null)
        {
            request.Headers.TryAddWithoutValidation("Origin", origin);
        }

        return client.SendAsync(request);
    }

    private static string Body(string? refreshToken) => JsonSerializer.Serialize(new { refreshToken });

    private static string RandomToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

    private static string SwapCase(string value) =>
        new(value.Select(c => char.IsUpper(c) ? char.ToLowerInvariant(c) : char.ToUpperInvariant(c)).ToArray());

    private static string Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) || response.Content.Headers.TryGetValues(name, out values)
            ? string.Join(", ", values)
            : "";

    private async Task<Stored> StoredAsync(Guid userId)
    {
        using var scope = _fixture.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Id == userId);
        return new Stored(user.RefreshToken, user.RefreshTokenExpiryTime, user.ConcurrencyStamp);
    }

    /// <summary>An access token signed like the API's own, expiring <paramref name="expiresIn"/> from now.</summary>
    private string AccessToken(Guid userId, string email, TimeSpan expiresIn)
    {
        var settings = _fixture.Factory.Services.GetRequiredService<IConfiguration>().GetSection("JwtSettings");
        var now = DateTime.UtcNow;
        var handler = new JwtSecurityTokenHandler();
        return handler.WriteToken(handler.CreateToken(new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(new[]
            {
                new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
                new Claim(JwtRegisteredClaimNames.Email, email),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
            }),
            IssuedAt = now.Add(expiresIn).AddMinutes(-15),
            NotBefore = now.Add(expiresIn).AddMinutes(-15),
            Expires = now.Add(expiresIn),
            Issuer = settings["Issuer"],
            Audience = settings["Audience"],
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings["Secret"]!)), SecurityAlgorithms.HmacSha256)
        }));
    }

    /// <summary>Expired an hour ago: well past the JWT handler's 5-minute clock skew.</summary>
    private string ExpiredAccessToken(TestUser user) => AccessToken(user.Id, user.Email, TimeSpan.FromHours(-1));

    private async Task AssertRevokedAsync(Session session, Stored before)
    {
        var after = await StoredAsync(session.User.Id);
        Assert.Null(after.RefreshToken);
        Assert.InRange(after.ExpiryUtc, DateTime.UtcNow.AddMinutes(-5), DateTime.UtcNow.AddSeconds(5));
        Assert.NotEqual(before.ConcurrencyStamp, after.ConcurrencyStamp);

        var refresh = await RefreshAsync(session.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
    }

    [Fact]
    public async Task The_expired_test_access_token_is_rejected_only_for_being_expired()
    {
        var session = await SignInAsync();

        Assert.Equal(HttpStatusCode.Unauthorized,
            (await Client(ExpiredAccessToken(session.User)).GetAsync("/api/users/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await Client(AccessToken(session.User.Id, session.User.Email, TimeSpan.FromMinutes(10))).GetAsync("/api/users/me")).StatusCode);
    }

    [Theory]
    [InlineData("expired")]
    [InlineData("none")]
    [InlineData("malformed")]
    public async Task The_refresh_token_ends_the_session_without_a_valid_access_token(string accessToken)
    {
        // The owner's scenario: the access token expired while the API slept; the user signs out.
        var session = await SignInAsync();
        var before = await StoredAsync(session.User.Id);
        var client = Client(accessToken switch
        {
            "expired" => ExpiredAccessToken(session.User),
            "malformed" => "not-a-jwt",
            _ => null
        });

        var response = await LogoutAsync(client, Body(session.RefreshToken));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsByteArrayAsync());
        await AssertRevokedAsync(session, before);
    }

    [Theory]
    [InlineData(null)] // no body and no Content-Type
    [InlineData("")] // Content-Type: application/json with an empty body
    [InlineData("{}")]
    public async Task A_signed_in_logout_with_only_the_access_token_still_ends_the_session(string? json)
    {
        // The frontend's existing call: POST /auth/logout with the bearer token and no refresh token.
        var session = await SignInAsync();
        var before = await StoredAsync(session.User.Id);

        var response = await LogoutAsync(Client(session.AccessToken), json);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await AssertRevokedAsync(session, before);
    }

    [Fact]
    public async Task A_valid_access_token_and_the_refresh_token_together_end_the_session()
    {
        var session = await SignInAsync();
        var before = await StoredAsync(session.User.Id);

        var response = await LogoutAsync(Client(session.AccessToken), Body(session.RefreshToken));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await AssertRevokedAsync(session, before);
    }

    [Fact]
    public async Task The_access_token_and_the_refresh_token_each_end_their_own_session()
    {
        var signedIn = await SignInAsync();
        var other = await SignInAsync();
        var signedInBefore = await StoredAsync(signedIn.User.Id);
        var otherBefore = await StoredAsync(other.User.Id);

        var response = await LogoutAsync(Client(signedIn.AccessToken), Body(other.RefreshToken));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await AssertRevokedAsync(signedIn, signedInBefore);
        await AssertRevokedAsync(other, otherBefore);
    }

    [Theory]
    [InlineData("no body")]
    [InlineData("empty body")]
    [InlineData("empty object")]
    [InlineData("null token")]
    [InlineData("empty token")]
    [InlineData("blank token")]
    [InlineData("unknown token")]
    [InlineData("prefix of the token")]
    [InlineData("token plus a character")]
    [InlineData("oversized token")]
    public async Task Without_a_valid_access_token_a_wrong_or_missing_refresh_token_is_204_and_changes_nothing(string kind)
    {
        var session = await SignInAsync();
        var before = await StoredAsync(session.User.Id);
        var token = session.RefreshToken;
        var json = kind switch
        {
            "no body" => null,
            "empty body" => "",
            "empty object" => "{}",
            "null token" => "{\"refreshToken\":null}",
            "empty token" => Body(""),
            "blank token" => Body("   "),
            "unknown token" => Body(RandomToken()),
            "prefix of the token" => Body(token[..^1]),
            "token plus a character" => Body(token + "A"),
            "oversized token" => Body(token + new string('A', 600)),
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };

        var response = await LogoutAsync(Client(ExpiredAccessToken(session.User)), json);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(before, await StoredAsync(session.User.Id));
        Assert.Equal(HttpStatusCode.OK, (await RefreshAsync(token)).StatusCode);
    }

    [Fact]
    public async Task A_token_that_differs_only_in_case_is_found_by_sql_but_not_accepted()
    {
        var session = await SignInAsync();
        var before = await StoredAsync(session.User.Id);
        var otherCase = SwapCase(session.RefreshToken);
        Assert.NotEqual(session.RefreshToken, otherCase);

        // SQL Server's default collation is case-insensitive, so the lookup alone would match...
        using (var scope = _fixture.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            Assert.True(await db.Users.AnyAsync(u => u.Id == session.User.Id && u.RefreshToken == otherCase));
        }

        // ...but logout confirms the match with an exact comparison.
        var response = await LogoutAsync(Client(), Body(otherCase));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(before, await StoredAsync(session.User.Id));
    }

    [Fact]
    public async Task A_rotated_refresh_token_does_not_end_the_newer_session()
    {
        var session = await SignInAsync();
        var (_, rotated) = await ReadTokensAsync(await RefreshAsync(session.RefreshToken));
        var before = await StoredAsync(session.User.Id);
        Assert.Equal(rotated, before.RefreshToken);

        var response = await LogoutAsync(Client(), Body(session.RefreshToken));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(before, await StoredAsync(session.User.Id));
        Assert.Equal(HttpStatusCode.OK, (await RefreshAsync(rotated)).StatusCode);
    }

    [Fact]
    public async Task An_expired_refresh_token_is_still_revoked()
    {
        var session = await SignInAsync();
        using (var scope = _fixture.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            await db.Users.Where(u => u.Id == session.User.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(u => u.RefreshTokenExpiryTime, DateTime.UtcNow.AddDays(-1)));
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await RefreshAsync(session.RefreshToken)).StatusCode);
        var before = await StoredAsync(session.User.Id);
        Assert.Equal(session.RefreshToken, before.RefreshToken);

        var response = await LogoutAsync(Client(), Body(session.RefreshToken));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        await AssertRevokedAsync(session, before);
    }

    [Fact]
    public async Task A_refresh_that_read_the_user_before_the_logout_cannot_write_the_session_back()
    {
        var session = await SignInAsync();
        using var scope = _fixture.CreateScope();
        var userManager = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

        // What a racing /auth/refresh does: load the user by token...
        var stale = await userManager.Users.SingleAsync(u => u.RefreshToken == session.RefreshToken);

        // ...the logout wins the race...
        Assert.Equal(HttpStatusCode.NoContent, (await LogoutAsync(Client(), Body(session.RefreshToken))).StatusCode);

        // ...and the refresh's save of the rotated token is refused instead of reviving the session.
        stale.RefreshToken = RandomToken();
        stale.RefreshTokenExpiryTime = DateTime.UtcNow.AddDays(7);
        var result = await userManager.UpdateAsync(stale);

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, e => e.Code == nameof(IdentityErrorDescriber.ConcurrencyFailure));
        Assert.Null((await StoredAsync(session.User.Id)).RefreshToken);
    }

    [Fact]
    public async Task Login_and_refresh_still_work_around_a_logout()
    {
        var session = await SignInAsync();

        var (access, rotated) = await ReadTokensAsync(await RefreshAsync(session.RefreshToken));
        Assert.NotEqual(session.RefreshToken, rotated);
        Assert.Equal(HttpStatusCode.Unauthorized, (await RefreshAsync(session.RefreshToken)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Client(access).GetAsync("/api/users/me")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await LogoutAsync(Client(access), Body(rotated))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await RefreshAsync(rotated)).StatusCode);

        // Signing in again starts a new, working session.
        var (_, again) = await LoginAsync(session.User.Email);
        Assert.Equal(HttpStatusCode.OK, (await RefreshAsync(again)).StatusCode);
    }

    [Fact]
    public async Task Logout_is_limited_to_20_requests_a_minute_per_client_ip()
    {
        var ip = TestClientIp.Unique();
        var client = Client(ip: ip);
        for (var i = 0; i < 20; i++)
        {
            Assert.Equal(HttpStatusCode.NoContent, (await LogoutAsync(client, Body(RandomToken()))).StatusCode);
        }

        var limited = await LogoutAsync(client, Body(RandomToken()), Origin);

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        var retryAfter = int.Parse(Header(limited, "Retry-After"));
        Assert.InRange(retryAfter, 1, 60);
        Assert.Equal("no-store", Header(limited, "Cache-Control"));
        Assert.Equal(Origin, Header(limited, "Access-Control-Allow-Origin"));
        Assert.Contains("Retry-After", Header(limited, "Access-Control-Expose-Headers"));
        Assert.Equal("application/json", limited.Content.Headers.ContentType?.MediaType);
        using (var body = JsonDocument.Parse(await limited.Content.ReadAsStringAsync()))
        {
            Assert.Equal($"Too many sign-out requests. Please try again in {retryAfter} second{(retryAfter == 1 ? "" : "s")}.",
                body.RootElement.GetProperty("message").GetString());
            Assert.Empty(body.RootElement.GetProperty("errors").EnumerateArray());
        }

        // Signed in or not, it is the client IP that counts.
        var session = await SignInAsync();
        Assert.Equal(HttpStatusCode.TooManyRequests, (await LogoutAsync(Client(session.AccessToken, ip), null)).StatusCode);
        Assert.NotNull((await StoredAsync(session.User.Id)).RefreshToken);

        // Other clients, the health ping and the other auth endpoints are not affected.
        Assert.Equal(HttpStatusCode.NoContent, (await LogoutAsync(Client(), Body(RandomToken()))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Client(ip: ip).GetAsync("/api/health")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Client(ip: ip).PostAsJsonAsync("/api/auth/refresh",
            new { refreshToken = session.RefreshToken })).StatusCode);
    }

    [Fact]
    public async Task Health_is_an_anonymous_uncached_204_without_database_access()
    {
        HttpResponseMessage response;
        using (_fixture.SqlCommands.Start())
        {
            response = await Client().GetAsync("/api/health");
        }

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(0, _fixture.SqlCommands.Count);
        Assert.Equal("no-store", Header(response, "Cache-Control"));

        // An expired or malformed access token does not matter, and the browser may call it cross-origin.
        foreach (var bearer in new[] { AccessToken(Guid.NewGuid(), "nobody@tests.local", TimeSpan.FromHours(-1)), "not-a-jwt" })
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "/api/health");
            request.Headers.TryAddWithoutValidation("Origin", Origin);
            var ping = await Client(bearer).SendAsync(request);
            Assert.Equal(HttpStatusCode.NoContent, ping.StatusCode);
            Assert.Equal(Origin, Header(ping, "Access-Control-Allow-Origin"));
        }

        // Never rate limited: far more pings from one client IP than any limit allows.
        var client = Client();
        for (var i = 0; i < 60; i++)
        {
            Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/api/health")).StatusCode);
        }
    }

    [Fact]
    public async Task The_contract_is_in_the_swagger_document()
    {
        var response = await Client().GetAsync("/swagger/v1/swagger.json");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var swagger = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        // Paths keep the controller's casing ("/api/Auth/logout").
        var paths = swagger.RootElement.GetProperty("paths").EnumerateObject()
            .ToDictionary(p => p.Name, p => p.Value, StringComparer.OrdinalIgnoreCase);
        Assert.True(paths["/api/health"].TryGetProperty("get", out _));
        var logout = paths["/api/auth/logout"].GetProperty("post");
        Assert.Contains("LogoutRequest", logout.GetProperty("requestBody").GetRawText());
        Assert.True(logout.GetProperty("responses").TryGetProperty("204", out _));
        Assert.True(logout.GetProperty("responses").TryGetProperty("429", out _));
    }
}
