using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace TimePlanner.API.Tests.Integration;

/// <summary>An organization with an owner, an admin, a member and an outsider, built through the API.</summary>
public sealed record OrgSetup(
    Guid OrgId,
    string OrgName,
    TestUser Owner,
    TestUser Admin,
    TestUser Member,
    TestUser Outsider);

public static class OrgTestKit
{
    public static async Task<OrgSetup> CreateAsync(ApiFixture fixture, string? timeZoneHeader = null)
    {
        var owner = await fixture.CreateUserAsync();
        var admin = await fixture.CreateUserAsync();
        var member = await fixture.CreateUserAsync();
        var outsider = await fixture.CreateUserAsync();

        var name = $"Org {Guid.NewGuid():N}";
        using var create = new HttpRequestMessage(HttpMethod.Post, "/api/organizations") { Content = JsonContent.Create(new { name }) };
        if (timeZoneHeader is not null)
        {
            create.Headers.TryAddWithoutValidation("X-Time-Zone", timeZoneHeader);
        }

        var created = await owner.Client.SendAsync(create);
        var body = await ReadJsonAsync(created, HttpStatusCode.Created);
        var orgId = body.GetProperty("id").GetGuid();

        await JoinAsync(admin, body.GetProperty("adminJoinCode").GetString()!);
        await JoinAsync(member, body.GetProperty("memberJoinCode").GetString()!);

        return new OrgSetup(orgId, name, owner, admin, member, outsider);
    }

    public static async Task JoinAsync(TestUser user, string joinCode)
    {
        var response = await user.Client.PostAsJsonAsync("/api/organizations/join", new { joinCode });
        await ReadJsonAsync(response, HttpStatusCode.OK);
    }

    /// <summary>Creates an organization task assigned to <paramref name="assignees"/> (creator must be Owner/Admin).</summary>
    public static async Task<Guid> CreateOrgTaskAsync(
        TestUser creator, Guid orgId, string title, string start, double duration, params TestUser[] assignees)
    {
        var response = await creator.Client.PostAsJsonAsync($"/api/organizations/{orgId}/tasks", new
        {
            organizationId = orgId,
            title,
            start,
            duration,
            categoryId = creator.CategoryId,
            assigneeIds = assignees.Select(a => a.Id).ToArray()
        });
        return (await ReadJsonAsync(response, HttpStatusCode.Created)).GetProperty("id").GetGuid();
    }

    /// <summary>Creates an organization task the caller assigns to themselves (any active member).</summary>
    public static async Task<Guid> CreateSelfOrgTaskAsync(TestUser member, Guid orgId, string title, string start, double duration)
    {
        var response = await member.Client.PostAsJsonAsync($"/api/organizations/{orgId}/tasks/personal", new
        {
            organizationId = orgId,
            title,
            start,
            duration,
            categoryId = member.CategoryId
        });
        return (await ReadJsonAsync(response, HttpStatusCode.Created)).GetProperty("id").GetGuid();
    }

    public static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response, HttpStatusCode expected)
    {
        var content = await response.Content.ReadAsStringAsync();
        Assert.True(response.StatusCode == expected, $"Expected {(int)expected}, got {(int)response.StatusCode}: {content}");
        if (string.IsNullOrWhiteSpace(content))
        {
            return default;
        }

        using var document = JsonDocument.Parse(content);
        return document.RootElement.Clone();
    }

    public static async Task<string?> ReadMessageAsync(HttpResponseMessage response)
    {
        var content = await response.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(content))
        {
            return null;
        }

        using var document = JsonDocument.Parse(content);
        return document.RootElement.TryGetProperty("message", out var message) ? message.GetString() : null;
    }
}
