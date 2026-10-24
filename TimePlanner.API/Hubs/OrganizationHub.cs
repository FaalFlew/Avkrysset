using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using System.Security.Claims;

namespace TimePlanner.API.Hubs;

// Authorize attribute ensures only logged-in users can connect.
[Authorize]
public class OrganizationHub : Hub
{
    // This method is called automatically when a client connects.
    public override async Task OnConnectedAsync()
    {
        // The User object is populated from the JWT bearer token.
        var user = Context.User;
        if (user?.Identity?.IsAuthenticated == true)
        {
            // Find all organization membership claims we added to the token.
            var membershipClaims = user.FindAll("organization_membership");

            foreach (var claim in membershipClaims)
            {
                // The claim value is "organizationId:Role"
                var orgId = claim.Value.Split(':')[0];

                // Add the connection to a SignalR group named after the organization's ID.
                // This allows us to easily broadcast messages to all members of a specific organization.
                await Groups.AddToGroupAsync(Context.ConnectionId, GetGroupName(orgId));
            }
        }

        await base.OnConnectedAsync();
    }

    // A helper to create consistent group names.
    public static string GetGroupName(Guid organizationId) => $"org-{organizationId}";
    public static string GetGroupName(string organizationId) => $"org-{organizationId}";
}