using FluentValidation;
using MediatR;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Api.Data;
using Api.DTOs.Auth;
using Api.Models;
using Api.Services;

namespace Api.Features.Auth.Commands;

public record RegisterCommand(
    string Email,
    string Password,
    MigrationData? MigrationData) : IRequest<AuthResponse>;


public class RegisterCommandValidator : AbstractValidator<RegisterCommand>
{
    public RegisterCommandValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("Email is required.")
            .EmailAddress().WithMessage("A valid email address is required.");

        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("Password is required.")
            .MinimumLength(8).WithMessage("Password must be at least 8 characters long.")
            // Example of a more complex password rule
            .Matches("[A-Z]").WithMessage("Password must contain at least one uppercase letter.")
            .Matches("[a-z]").WithMessage("Password must contain at least one lowercase letter.")
            .Matches("[0-9]").WithMessage("Password must contain at least one number.")
            .Matches("[^a-zA-Z0-9]").WithMessage("Password must contain at least one non-alphanumeric character.");
    }
}

public class RegisterCommandHandler : IRequestHandler<RegisterCommand, AuthResponse>
{
    private readonly UserManager<User> _userManager;
    private readonly ITokenService _tokenService;
    private readonly ApplicationDbContext _context;

    public RegisterCommandHandler(UserManager<User> userManager, ITokenService tokenService, ApplicationDbContext context)
    {
        _userManager = userManager;
        _tokenService = tokenService;
        _context = context;
    }

    public async Task<AuthResponse> Handle(RegisterCommand request, CancellationToken cancellationToken)
    {
        var existingUser = await _userManager.FindByEmailAsync(request.Email);
        if (existingUser != null)
        {
            throw new InvalidOperationException("A user with this email already exists.");
        }

        var user = new User
        {
            UserName = request.Email,
            Email = request.Email,
            EmailConfirmed = true
        };

        var result = await _userManager.CreateAsync(user, request.Password);
        if (!result.Succeeded)
        {
            var errors = string.Join("\n", result.Errors.Select(e => e.Description));
            throw new ValidationException(errors);
        }

        if (request.MigrationData != null && request.MigrationData.Categories.Any())
        {

            await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                await MigrateUserDataAsync(user, request.MigrationData, cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }
            catch (Exception)
            {
                await transaction.RollbackAsync(cancellationToken);

            }
        }

        // --- 4. Generate tokens ---
        var (accessToken, refreshToken) = _tokenService.GenerateTokens(user);

        user.RefreshToken = refreshToken;
        user.RefreshTokenExpiryTime = DateTime.UtcNow.AddDays(7);
        await _userManager.UpdateAsync(user);

        return new AuthResponse
        {
            AccessToken = accessToken,
            RefreshToken = refreshToken
        };
    }

    private async Task MigrateUserDataAsync(User user, MigrationData data, CancellationToken ct)
    {

        var categoryIdMap = new Dictionary<string, Guid>();

        foreach (var catDto in data.Categories)
        {
            var newCategory = new Category
            {
                Name = catDto.Name,
                Color = catDto.Color,
                User = user
            };
            _context.Categories.Add(newCategory);
            categoryIdMap[catDto.Id] = newCategory.Id;
        }

        await _context.SaveChangesAsync(ct);

        var templateIdMap = new Dictionary<string, Guid>();

        foreach (var templateDto in data.Templates)
        {
            if (categoryIdMap.TryGetValue(templateDto.CategoryId, out var newCategoryId))
            {
                var newTemplate = new TaskTemplate
                {
                    Title = templateDto.Title,
                    Duration = templateDto.Duration,
                    CategoryId = newCategoryId,
                    User = user
                };
                _context.TaskTemplates.Add(newTemplate);
            }
        }

        foreach (var taskDto in data.Tasks)
        {
            if (categoryIdMap.TryGetValue(taskDto.CategoryId, out var newCategoryId))
            {
                var newTask = new TaskItem
                {
                    Title = taskDto.Title,
                    Start = DateTime.Parse(taskDto.Start, null, System.Globalization.DateTimeStyles.RoundtripKind),
                    Duration = taskDto.Duration,
                    CategoryId = newCategoryId,
                    User = user
                };
                _context.Tasks.Add(newTask);
            }
        }

        await _context.SaveChangesAsync(ct);
    }
}