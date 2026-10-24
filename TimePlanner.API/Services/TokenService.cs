using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using TimePlanner.API.Models;
using Microsoft.EntityFrameworkCore; // Add this
using TimePlanner.API.Data; // Add this
using TimePlanner.API.Models.Organization; // Add this


namespace TimePlanner.API.Services;

public class TokenService : ITokenService
{
    private readonly IConfiguration _configuration;
    private readonly ApplicationDbContext _context; // Add this


    public TokenService(IConfiguration configuration, ApplicationDbContext context)
    {
        _configuration = configuration;
        _context = context; // Add this
    }

    // CHANGE GenerateTokens to be async to allow for DB query
    public async Task<(string accessToken, string refreshToken)> GenerateTokensAsync(User user)
    {
        var accessToken = await GenerateAccessTokenAsync(user); // Make async
        var refreshToken = GenerateRefreshToken();

        return (accessToken, refreshToken);
    }

    /// <summary>
    /// Generates the short-lived JWT used to access protected API endpoints.
    /// </summary>
    public async Task<string> GenerateAccessTokenAsync(User user)
    {
        var jwtSettings = _configuration.GetSection("JwtSettings");
        var secretKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings["Secret"]!));
        var signingCredentials = new SigningCredentials(secretKey, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email!),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };

        // --- NEW LOGIC: ADD ORGANIZATION MEMBERSHIP CLAIMS ---
        var memberships = await _context.OrganizationMemberships
            .AsNoTracking()
            .Where(m => m.UserId == user.Id && m.Status == MembershipStatus.Active)
            .Select(m => new { m.OrganizationId, m.Role })
            .ToListAsync();

        foreach (var membership in memberships)
        {
            // We'll add a custom claim for each active membership.
            // Format: "organizationId:Role" e.g., "guid-guid-guid:Admin"
            claims.Add(new Claim("organization_membership", $"{membership.OrganizationId}:{membership.Role}"));
        }

        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Expires = DateTime.UtcNow.AddMinutes(15),
            Issuer = jwtSettings["Issuer"],
            Audience = jwtSettings["Audience"],
            SigningCredentials = signingCredentials
        };

        var tokenHandler = new JwtSecurityTokenHandler();
        var token = tokenHandler.CreateToken(tokenDescriptor);

        return tokenHandler.WriteToken(token);
    }

    /// <summary>
    /// Generates a cryptographically secure, random string to be used as a refresh token.
    /// </summary>
    public string GenerateRefreshToken()
    {
        var randomNumber = new byte[64];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(randomNumber);
        return Convert.ToBase64String(randomNumber);
    }
}