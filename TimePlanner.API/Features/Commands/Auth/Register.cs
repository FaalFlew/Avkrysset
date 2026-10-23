using FluentValidation;
using MediatR;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Auth;
using TimePlanner.API.Models;
using TimePlanner.API.Services;
using TimePlanner.API.Exceptions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;
namespace TimePlanner.API.Features.Commands.Auth;

using Microsoft.AspNetCore.WebUtilities; // Add this
using System.Text; // Add this

//================================================================================
// 1. The Command
//================================================================================
// A command is a request to change the state of the system.
// It carries all the data needed for the action. We use 'record' for immutability.
// It returns an 'AuthResponse' DTO on success.
public record RegisterCommand(
    string Email,
    string Password,
    MigrationData? MigrationData) : IRequest;

//================================================================================
// 2. The Validator
//================================================================================
// This class defines the validation rules for the RegisterCommand.
// FluentValidation will be automatically picked up by a middleware later.
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

//================================================================================
// 3. The Handler
//================================================================================
// This class contains the business logic to handle the RegisterCommand.
// It depends on the services it needs, which are provided by DI.
public class RegisterCommandHandler : IRequestHandler<RegisterCommand>
{
    private readonly ILogger<RegisterCommandHandler> _logger;
    private readonly UserManager<User> _userManager;
    private readonly ApplicationDbContext _context; // 1. Inject the factory
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration; // To get the frontend URL

    public RegisterCommandHandler(
        UserManager<User> userManager,
        ApplicationDbContext context,
        IEmailService emailService,
        IConfiguration configuration,
        ILogger<RegisterCommandHandler> logger) // <-- MODIFIED CONSTRUCTOR
    {
        _userManager = userManager;
        _context = context; // 3. Assign it
        _logger = logger; // <-- ADD THIS
        _emailService = emailService; // <-- ADD
        _configuration = configuration; // <-- ADD
    }

    public async Task Handle(RegisterCommand request, CancellationToken cancellationToken)
    {

        // 1. Check if user already exists
        var existingUser = await _userManager.FindByEmailAsync(request.Email);
        if (existingUser != null)
        {
            // 2. If user exists, check if they are already confirmed.
            if (existingUser.EmailConfirmed)
            {
                // 2a. USER IS ACTIVE AND CONFIRMED. This is a true conflict.
                _logger.LogWarning("Registration attempt for an already confirmed email: {Email}", request.Email);
                throw new ConflictException($"A user with the email '{request.Email}' already exists.");
            }
            else
            {
                // 2b. USER EXISTS BUT IS NOT CONFIRMED. Resend the email.
                _logger.LogInformation("Unconfirmed user re-registered. Resending confirmation email to {Email}", request.Email);
                await SendConfirmationEmailAsync(existingUser);

                // Return successfully. The frontend will treat this the same as a new registration
                // and redirect to the "check-email" page.
                return;
            }
        }

        // --- 2. Create the new user ---
        var user = new User
        {
            UserName = request.Email,
            Email = request.Email,
        };

        // This is the most critical check.
        var identityResult = await _userManager.CreateAsync(user, request.Password);
        if (!identityResult.Succeeded)
        {
            // If user creation fails (e.g., duplicate email detected by the database unique index),
            // we must throw an exception to halt execution.
            var errors = string.Join(", ", identityResult.Errors.Select(e => e.Description));
            throw new ValidationException(errors);
        }
        _logger.LogInformation("User with email {Email} created successfully.", request.Email);
        try
        {
            var otherCategory = new Category
            {
                Name = "Other",
                Color = "#8B949E", // A neutral grey color
                UserId = user.Id
            };
            _context.Categories.Add(otherCategory);
            await _context.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Default 'Other' category created for user {Email}.", request.Email);
        }
        catch (Exception ex)
        {
            // If category creation fails for some reason (e.g., database issue),
            // this is a critical failure. We must roll back the user creation.
            _logger.LogError(ex, "Failed to create default category for user {Email}. Rolling back user creation.", request.Email);
            await _userManager.DeleteAsync(user);

            // Rethrow a more generic exception to the client.
            throw new InvalidOperationException("User registration failed due to an internal error. The user has not been created.");
        }

        // --- 3. Data Migration ---

        if (request.MigrationData != null && request.MigrationData.Categories.Any())
        {
            // The transaction is now on the handler's single context.
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
                // If migration fails, we must NOT proceed. We should undo the user creation.
                // This makes the entire registration process truly atomic.
                await _userManager.DeleteAsync(user);
                // And then we throw an exception to inform the client that the process failed.
                // We can create a more specific exception type if needed.
                throw new InvalidOperationException($"Data migration failed, and user registration has been rolled back. Please try again. Error: {ex.Message}", ex);
            }
        }

        // CHANGE 3: Generate confirmation token and send email instead of login tokens.
        await SendConfirmationEmailAsync(user);

    }

    private async Task SendConfirmationEmailAsync(User user)
    {
        // 1. Generate the token
        var token = await _userManager.GenerateEmailConfirmationTokenAsync(user);
        // 2. URL-encode the token to make it safe to transport in a URL
        var encodedToken = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));

        // 3. Get the frontend URL from configuration
        // In appsettings.json, you should add: "FrontendBaseUrl": "http://localhost:5173"
        var frontendUrl = _configuration["FrontendBaseUrl"];
        var confirmationLink = $"{frontendUrl}/confirm-email?userId={user.Id}&token={encodedToken}";

        // 4. Create email body and send
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
        // Step 1 & 2: Categories and Templates (Save and Map) - These parts are correct and remain unchanged.
        // ... (logic for saving categories and templates and creating categoryIdMap and templateIdMap) ...
        // --- Assume categoryIdMap and templateIdMap are correctly populated here ---

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


        // --- Step 3: Handle Tasks (with corrected inheritance logic) ---
        var tasksToAdd = new List<TaskItem>();

        // For easier lookup, let's create a dictionary of the template DTOs by their old ID.
        // This is the key piece to access the template's original properties.
        var templateDtoMap = data.Templates.ToDictionary(t => t.Id);

        foreach (var taskDto in data.Tasks)
        {
            string title;
            double duration;
            Guid categoryId;
            Guid? templateId = null;

            // Check if the task is derived from a template. This is the corrected block.
            if (!string.IsNullOrEmpty(taskDto.TemplateId) &&
                templateDtoMap.TryGetValue(taskDto.TemplateId, out var foundTemplateDto) && // 1. Find the DTO
                templateIdMap.TryGetValue(taskDto.TemplateId, out var newTemplateGuid))     // 2. Find the new Guid
            {
                // --- INHERITANCE LOGIC ---
                // The task is from a template. Inherit its properties from the DTO.
                title = foundTemplateDto.Title;
                duration = foundTemplateDto.Duration;

                // We still need the real category Guid from the category map.
                if (!categoryIdMap.TryGetValue(foundTemplateDto.CategoryId, out categoryId))
                {
                    // Data corruption from the frontend. Skip this task.
                    continue;
                }
                templateId = newTemplateGuid; // Set the real template Guid
            }
            else
            {
                // --- AD-HOC TASK LOGIC ---
                // This is a regular, non-templated task. Use its own properties.
                title = taskDto.Title;
                duration = taskDto.Duration;

                if (!categoryIdMap.TryGetValue(taskDto.CategoryId, out categoryId))
                {
                    // Category not found, skip this task.
                    continue;
                }
            }

            // Now, create the TaskItem with the correctly sourced properties.
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

        // --- Step 4: Final Save for Tasks ---
        context.Tasks.AddRange(tasksToAdd);
        await context.SaveChangesAsync(ct);
    }
}