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
using System.Globalization;
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
        // These rules match the Identity options in Program.cs (ASCII letter/digit classes like Identity's
        // PasswordValidator), so they reject nothing Identity would accept; they only give clearer messages.
        // Migration data is deliberately not validated: the migration code tolerates odd guest data.
        RuleFor(x => x.Email).Cascade(CascadeMode.Stop)
            .NotEmpty().WithMessage("Email is required.")
            .EmailAddress().WithMessage("A valid email address is required.");

        RuleFor(x => x.Password).Cascade(CascadeMode.Stop)
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
    // Every account gets this category at registration; guest items without a migrated category land in it.
    private const string DefaultCategoryName = "Other";

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
        Category otherCategory;
        try
        {
            otherCategory = new Category
            {
                Name = DefaultCategoryName,
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

        // A guest who only used the default "Other" category sends no categories (the client leaves "Other" out),
        // so any guest data at all must trigger the migration.
        if (request.MigrationData != null && HasAnyData(request.MigrationData))
        {
            var otherCategoryId = otherCategory.Id;
            try
            {
                // The context uses a retrying execution strategy (EnableRetryOnFailure), which rejects a
                // user-initiated transaction unless the whole unit runs inside the strategy.
                var strategy = _context.Database.CreateExecutionStrategy();
                await strategy.ExecuteAsync(async () =>
                {
                    // A retried attempt must not see entities left over from a rolled-back one.
                    _context.ChangeTracker.Clear();
                    await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);
                    await MigrateUserDataAsync(user.Id, otherCategoryId, request.MigrationData, _context, cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                });
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

    private static bool HasAnyData(MigrationData data) =>
        (data.Categories?.Count ?? 0) + (data.Templates?.Count ?? 0) + (data.Tasks?.Count ?? 0) > 0;

    private async Task MigrateUserDataAsync(
    Guid userId,
    Guid otherCategoryId,
    MigrationData data,
    ApplicationDbContext context,
    CancellationToken ct)
    {
        var categoryDtos = data.Categories ?? new List<CategoryMigrationDto>();
        var templateDtos = data.Templates ?? new List<TaskTemplateMigrationDto>();
        var taskDtos = data.Tasks ?? new List<TaskItemMigrationDto>();

        // --- Step 1: Categories ---
        // Maps guest category ids to the new Guids. A guest category whose name already exists (the guest's
        // own "Other", or a repeated name) maps onto that category instead of breaking the unique
        // (UserId, Name) index. Names compare like the database does: case-insensitive, trailing spaces ignored.
        var categoryIdMap = new Dictionary<string, Guid>(StringComparer.Ordinal);
        var categoryIdsByName = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase)
        {
            [DefaultCategoryName] = otherCategoryId
        };
        var categoriesCreated = 0;
        foreach (var catDto in categoryDtos)
        {
            var nameKey = (catDto.Name ?? string.Empty).Trim();
            if (!categoryIdsByName.TryGetValue(nameKey, out var categoryId))
            {
                var newCategory = new Category { Name = catDto.Name ?? string.Empty, Color = catDto.Color, UserId = userId };
                context.Categories.Add(newCategory); // the Guid key is generated here, on Add
                categoryId = newCategory.Id;
                categoryIdsByName[nameKey] = categoryId;
                categoriesCreated++;
            }

            categoryIdMap.TryAdd(catDto.Id ?? string.Empty, categoryId);
        }
        await context.SaveChangesAsync(ct);

        // Items whose category was not sent go to the default "Other" category. The client never sends the
        // guest's "Other" (the account already has one), so this is the normal path for those items.
        var movedToOther = 0;
        Guid ResolveCategory(string? guestCategoryId)
        {
            if (guestCategoryId is not null && categoryIdMap.TryGetValue(guestCategoryId, out var mapped))
            {
                return mapped;
            }

            movedToOther++;
            return otherCategoryId;
        }

        // --- Step 2: Templates (every template is migrated) ---
        var templatesByGuestId = new Dictionary<string, (Guid Id, Guid CategoryId, TaskTemplateMigrationDto Dto)>(StringComparer.Ordinal);
        foreach (var templateDto in templateDtos)
        {
            var newTemplate = new TaskTemplate
            {
                Title = templateDto.Title,
                Duration = templateDto.Duration,
                CategoryId = ResolveCategory(templateDto.CategoryId),
                UserId = userId
            };
            context.TaskTemplates.Add(newTemplate);
            if (!string.IsNullOrEmpty(templateDto.Id))
            {
                templatesByGuestId.TryAdd(templateDto.Id, (newTemplate.Id, newTemplate.CategoryId, templateDto));
            }
        }
        await context.SaveChangesAsync(ct);

        // --- Step 3: Tasks ---
        var tasksToAdd = new List<TaskItem>();
        var unreadableStarts = 0;
        foreach (var taskDto in taskDtos)
        {
            if (!TryParseMigratedStart(taskDto.Start, out var start))
            {
                unreadableStarts++;
                _logger.LogWarning("Skipping a migrated task with an unreadable start value '{Start}'.", taskDto.Start);
                continue;
            }

            if (!string.IsNullOrEmpty(taskDto.TemplateId) && templatesByGuestId.TryGetValue(taskDto.TemplateId, out var template))
            {
                // --- INHERITANCE LOGIC ---
                // The task is from a template: it inherits the template's title, duration and category.
                tasksToAdd.Add(new TaskItem
                {
                    Title = template.Dto.Title,
                    Start = start,
                    Duration = template.Dto.Duration,
                    CategoryId = template.CategoryId,
                    TemplateId = template.Id,
                    UserId = userId
                });
            }
            else
            {
                // --- AD-HOC TASK LOGIC ---
                tasksToAdd.Add(new TaskItem
                {
                    Title = taskDto.Title,
                    Start = start,
                    Duration = taskDto.Duration,
                    CategoryId = ResolveCategory(taskDto.CategoryId),
                    UserId = userId
                });
            }
        }

        // --- Step 4: Final Save for Tasks ---
        context.Tasks.AddRange(tasksToAdd);
        await context.SaveChangesAsync(ct);

        _logger.LogInformation(
            "Guest data migration for user {UserId}: {CategoriesCreated} of {CategoriesSent} categories created " +
            "(the rest merged into existing ones), {Templates} templates, {TasksMigrated}/{TasksSent} tasks; " +
            "{MovedToOther} templates/tasks without a sent category put in '{Other}'.",
            userId, categoriesCreated, categoryDtos.Count, templateDtos.Count,
            tasksToAdd.Count, taskDtos.Count, movedToOther, DefaultCategoryName);

        if (unreadableStarts > 0)
        {
            _logger.LogWarning(
                "Guest data migration for user {UserId}: {Skipped} of {TasksSent} tasks were not migrated because their start could not be read.",
                userId, unreadableStarts, taskDtos.Count);
        }
    }

    /// <summary>
    /// Parses a guest task start into a UTC instant. The client sends UTC ISO strings
    /// ("2026-10-03T07:00:00.000Z"); a value with an offset is converted, one without is taken as UTC.
    /// Parsing is culture-independent so the server's culture cannot change the result.
    /// </summary>
    public static bool TryParseMigratedStart(string? value, out DateTime utcStart)
    {
        if (!string.IsNullOrWhiteSpace(value)
            && DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
        {
            utcStart = parsed.UtcDateTime;
            return true;
        }

        utcStart = default;
        return false;
    }
}