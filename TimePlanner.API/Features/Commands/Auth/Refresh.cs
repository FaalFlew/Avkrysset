using MediatR;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using TimePlanner.API.DTOs.Auth;
using TimePlanner.API.Models;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Auth;

//================================================================================
// 1. The Command
//================================================================================
public record RefreshCommand(string RefreshToken) : IRequest<AuthResponse>;

//================================================================================
// 2. The Handler
//================================================================================
public class RefreshCommandHandler : IRequestHandler<RefreshCommand, AuthResponse>
{
    private readonly UserManager<User> _userManager;
    private readonly ITokenService _tokenService;

    public RefreshCommandHandler(UserManager<User> userManager, ITokenService tokenService)
    {
        _userManager = userManager;
        _tokenService = tokenService;
    }

    public async Task<AuthResponse> Handle(RefreshCommand request, CancellationToken cancellationToken)
    {
        // --- 1. Find the user by the provided refresh token ---
        var user = await _userManager.Users.SingleOrDefaultAsync(
            u => u.RefreshToken == request.RefreshToken,
            cancellationToken);

        // --- 2. Validate the token ---
        if (user == null)
        {
            // Either token doesn't exist or has been invalidated.
            throw new UnauthorizedAccessException("Invalid refresh token.");
        }

        if (user.RefreshTokenExpiryTime <= DateTime.UtcNow)
        {
            // Token has expired.
            throw new UnauthorizedAccessException("Refresh token has expired. Please log in again.");
        }

        // --- 3. Generate new tokens ---
        var (newAccessToken, newRefreshToken) = await _tokenService.GenerateTokensAsync(user); // Use await

        // --- 4. Update the user's record with the new refresh token (rotation) ---
        user.RefreshToken = newRefreshToken;
        user.RefreshTokenExpiryTime = DateTime.UtcNow.AddDays(7);
        await _userManager.UpdateAsync(user);

        return new AuthResponse
        {
            AccessToken = newAccessToken,
            RefreshToken = newRefreshToken
        };
    }
}