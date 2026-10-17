using TimePlanner.API.Models;

namespace TimePlanner.API.Services;

/// <summary>
/// Defines the contract for a service that creates security tokens.
/// </summary>
public interface ITokenService
{
    /// <summary>
    /// Generates a JWT access token and a refresh token for the specified user.
    /// </summary>
    /// <param name="user">The user for whom to generate the tokens.</param>
    /// <returns>A tuple containing the JWT access token and the refresh token.</returns>
    Task<(string accessToken, string refreshToken)> GenerateTokensAsync(User user);
}