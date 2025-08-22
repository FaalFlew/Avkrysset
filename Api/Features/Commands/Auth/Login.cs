using FluentValidation;
using MediatR;
using Microsoft.AspNetCore.Identity;
using Api.DTOs.Auth;
using Api.Models;
using Api.Services;
using Microsoft.Extensions.Logging;

namespace Api.Features.Commands.Auth;

public record LoginCommand(string Email, string Password) : IRequest<AuthResponse>;

public class LoginCommandValidator : AbstractValidator<LoginCommand>
{
    public LoginCommandValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress();
        RuleFor(x => x.Password).NotEmpty();
    }
}

public class LoginCommandHandler : IRequestHandler<LoginCommand, AuthResponse>
{
    private readonly UserManager<User> _userManager;
    private readonly ITokenService _tokenService;
    private readonly ILogger<LoginCommandHandler> _logger;

    public LoginCommandHandler(UserManager<User> userManager, ITokenService tokenService, ILogger<LoginCommandHandler> logger)
    {
        _userManager = userManager;
        _tokenService = tokenService;
        _logger = logger;
    }

    public async Task<AuthResponse> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user == null)
        {
            _logger.LogWarning("Failed login attempt for email {Email}: User not found.", request.Email);

            throw new ValidationException("Invalid email or password.");
        }

        if (!user.EmailConfirmed)
        {
            _logger.LogWarning("Failed login attempt for email {Email}: Email not confirmed.", request.Email);
            throw new ApplicationException("Email has not been confirmed. Please check your inbox.");
        }

        var isPasswordValid = await _userManager.CheckPasswordAsync(user, request.Password);
        if (!isPasswordValid)
        {
            _logger.LogWarning("Failed login attempt for email {Email}: Invalid password.", request.Email);

            throw new ValidationException("Invalid email or password.");
        }

        var (accessToken, refreshToken) = _tokenService.GenerateTokens(user);

        user.RefreshToken = refreshToken;
        user.RefreshTokenExpiryTime = DateTime.UtcNow.AddDays(7);
        await _userManager.UpdateAsync(user);
        _logger.LogInformation("User with email {Email} logged in successfully.", request.Email);

        return new AuthResponse
        {
            AccessToken = accessToken,
            RefreshToken = refreshToken
        };
    }
}