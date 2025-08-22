using FluentValidation;
using MediatR;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Api.Data;
using Api.DTOs.Auth;
using Api.Models;
using Api.Services;
using Api.Exceptions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;
namespace Api.Features.Commands.Auth;

using Microsoft.AspNetCore.WebUtilities; // Add this
using System.Text; // Add this

public record RegisterCommand(
    string Email,
    string Password,
    MigrationData? MigrationData) : IRequest;

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

            .Matches("[A-Z]").WithMessage("Password must contain at least one uppercase letter.")
            .Matches("[a-z]").WithMessage("Password must contain at least one lowercase letter.")
            .Matches("[0-9]").WithMessage("Password must contain at least one number.")
            .Matches("[^a-zA-Z0-9]").WithMessage("Password must contain at least one non-alphanumeric character.");
    }
}

public class RegisterCommandHandler : IRequestHandler<RegisterCommand>
{
    private readonly ILogger<RegisterCommandHandler> _logger;
    private readonly UserManager<User> _userManager;
    private readonly ApplicationDbContext _context;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;

    public RegisterCommandHandler(
        UserManager<User> userManager,
        ApplicationDbContext context,
        IEmailService emailService,
        IConfiguration configuration,
        ILogger<RegisterCommandHandler> logger)
    {
        _userManager = userManager;
        _context = context;
        _logger = logger;
        _emailService = emailService;
        _configuration = configuration;
    }

    public async Task Handle(RegisterCommand request, CancellationToken cancellationToken)
    {
        var existingUser = await _userManager.FindByEmailAsync(request.Email);
        if (existingUser != null)
        {
            throw new ConflictException($"A user with the email '{request.Email}' already exists.");
        }

        var user = new User
        {
            UserName = request.Email,
            Email = request.Email,
        };

        var identityResult = await _userManager.CreateAsync(user, request.Password);
        if (!identityResult.Succeeded)
        {
            var errors = string.Join(", ", identityResult.Errors.Select(e => e.Description));
            throw new ValidationException(errors);
        }
        _logger.LogInformation("User with email {Email} created successfully.", request.Email);



        if (request.MigrationData != null && request.MigrationData.Categories.Any())
        {
            await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                await MigrateUserDataAsync(user.Id, request.MigrationData, _context, cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                _logger.LogInformation("Successfully migrated local data for user {Email}.", request.Email);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Data migration failed for user {Email}. Rolling back user creation.", request.Email);
                await _userManager.DeleteAsync(user);
                throw new InvalidOperationException($"Data migration failed, and user registration has been rolled back. Please try again. Error: {ex.Message}", ex);
            }
        }

        await SendConfirmationEmailAsync(user);

    }

    private async Task SendConfirmationEmailAsync(User user)
    {
        var token = await _userManager.GenerateEmailConfirmationTokenAsync(user);
        var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));

        var frontendUrl = _configuration["FrontendBaseUrl"];
        var confirmationLink = $"{frontendUrl}/confirm-email?userId={user.Id}&token={encodedToken}";

        var emailBody = $"<h1>Welcome to Time Planner!</h1>" +
                        $"<p>Please confirm your email address by clicking the link below:</p>" +
                        $"<p><a href='{confirmationLink}'>Confirm my email</a></p>" +
                        $"<p>Thank you,</p><p>The Time Planner Team</p>";

        await _emailService.SendEmailAsync(user.Email!, "Confirm Your Email Address", emailBody);
        _logger.LogInformation("Confirmation email sent to {Email}", user.Email);
    }

    private async Task MigrateUserDataAsync(
    Guid userId,
    MigrationData data,
    ApplicationDbContext context,
    CancellationToken ct)
    {

        var categoryPairs = new List<(CategoryMigrationDto Dto, Category Entity)>();
        foreach (var catDto in data.Categories)
        {
            var newCategory = new Category { Name = catDto.Name, Color = catDto.Color, UserId = userId };
            categoryPairs.Add((catDto, newCategory));
        }
        context.Categories.AddRange(categoryPairs.Select(p => p.Entity));
        await context.SaveChangesAsync(ct);
        var categoryIdMap = categoryPairs.ToDictionary(p => p.Dto.Id, p => p.Entity.Id);

        var templatePairs = new List<(TaskTemplateMigrationDto Dto, TaskTemplate Entity)>();
        foreach (var templateDto in data.Templates)
        {
            if (categoryIdMap.TryGetValue(templateDto.CategoryId, out var newCategoryId))
            {
                var newTemplate = new TaskTemplate { Title = templateDto.Title, Duration = templateDto.Duration, CategoryId = newCategoryId, UserId = userId };
                templatePairs.Add((templateDto, newTemplate));
            }
        }
        context.TaskTemplates.AddRange(templatePairs.Select(p => p.Entity));
        await context.SaveChangesAsync(ct);
        var templateIdMap = templatePairs.ToDictionary(p => p.Dto.Id, p => p.Entity.Id);


        var tasksToAdd = new List<TaskItem>();

        var templateDtoMap = data.Templates.ToDictionary(t => t.Id);

        foreach (var taskDto in data.Tasks)
        {
            string title;
            double duration;
            Guid categoryId;
            Guid? templateId = null;

            if (!string.IsNullOrEmpty(taskDto.TemplateId) &&
                templateDtoMap.TryGetValue(taskDto.TemplateId, out var foundTemplateDto) &&
                templateIdMap.TryGetValue(taskDto.TemplateId, out var newTemplateGuid))
            {
                title = foundTemplateDto.Title;
                duration = foundTemplateDto.Duration;

                if (!categoryIdMap.TryGetValue(foundTemplateDto.CategoryId, out categoryId))
                {
                    continue;
                }
                templateId = newTemplateGuid;
            }
            else
            {
                title = taskDto.Title;
                duration = taskDto.Duration;

                if (!categoryIdMap.TryGetValue(taskDto.CategoryId, out categoryId))
                {
                    continue;
                }
            }

            tasksToAdd.Add(new TaskItem
            {
                Title = title,
                Start = DateTime.Parse(taskDto.Start, null, System.Globalization.DateTimeStyles.RoundtripKind),
                Duration = duration,
                CategoryId = categoryId,
                TemplateId = templateId,
                UserId = userId
            });
        }

        context.Tasks.AddRange(tasksToAdd);
        await context.SaveChangesAsync(ct);
    }
}