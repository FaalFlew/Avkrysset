using FluentValidation;
using MediatR;
using Microsoft.AspNetCore.Identity;
using TimePlanner.API.DTOs.Auth;
using TimePlanner.API.Models;
using TimePlanner.API.Services;
using Microsoft.Extensions.Logging;
using TimePlanner.API.Exceptions;

namespace TimePlanner.API.Features.Commands.Auth;

//================================================================================
// 1. The Command
//================================================================================
public record LoginCommand(string Email, string Password) : IRequest<AuthResponse>;

//================================================================================
// 2. The Validator
//================================================================================
public class LoginCommandValidator : AbstractValidator<LoginCommand>
{
    public LoginCommandValidator()
    {
        RuleFor(x => x.Email).Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Email is required.")
            .EmailAddress().WithMessage("A valid email address is required.");
        RuleFor(x => x.Password).NotEmpty().WithMessage("Password is required.");
    }
}

//================================================================================
// 3. The Handler
//================================================================================
public class LoginCommandHandler : IRequestHandler<LoginCommand, AuthResponse>
{
    private readonly UserManager<User> _userManager;
    private readonly ITokenService _tokenService;
    private readonly ILogger<LoginCommandHandler> _logger; // 1. Add field

    public LoginCommandHandler(UserManager<User> userManager, ITokenService tokenService, ILogger<LoginCommandHandler> logger)
    {
        _userManager = userManager;
        _tokenService = tokenService;
        _logger = logger;
    }

    public async Task<AuthResponse> Handle(LoginCommand request, CancellationToken cancellationToken)
    {
        // --- 1. Find the user by email ---
        var user = await _userManager.FindByEmailAsync(request.Email);
        if (user == null)
        {
            _logger.LogWarning("Failed login attempt for email {Email}: User not found.", request.Email);

            // Do not reveal if the user exists or not. This is a security best practice.
            throw new ValidationException("Invalid email or password.");
        }

        // CHANGE: Add this check right after finding the user.
        if (!user.EmailConfirmed)
        {
            _logger.LogWarning("Failed login attempt for email {Email}: Email not confirmed.", request.Email);
            throw new BadRequestException("Email has not been confirmed. Please check your inbox.");
        }

        // --- 2. Check the password ---
        var isPasswordValid = await _userManager.CheckPasswordAsync(user, request.Password);
        if (!isPasswordValid)
        {
            _logger.LogWarning("Failed login attempt for email {Email}: Invalid password.", request.Email);

            throw new ValidationException("Invalid email or password.");
        }

        // --- 3. Generate tokens ---
        var (accessToken, refreshToken) = await _tokenService.GenerateTokensAsync(user); // Use await

        // --- 4. Update the user's refresh token ---
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