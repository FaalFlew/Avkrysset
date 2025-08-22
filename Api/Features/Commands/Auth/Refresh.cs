using MediatR;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using Api.DTOs.Auth;
using Api.Models;
using Api.Services;

namespace Api.Features.Commands.Auth;

public record RefreshCommand(string RefreshToken) : IRequest<AuthResponse>;

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
        var user = await _userManager.Users.SingleOrDefaultAsync(
            u => u.RefreshToken == request.RefreshToken,
            cancellationToken);

        if (user == null)
        {
            throw new ApplicationException("Invalid refresh token.");
        }

        if (user.RefreshTokenExpiryTime <= DateTime.UtcNow)
        {
            throw new ApplicationException("Refresh token has expired. Please log in again.");
        }

        var (newAccessToken, newRefreshToken) = _tokenService.GenerateTokens(user);

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