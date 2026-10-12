using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using TimePlanner.API.Data;
using TimePlanner.API.Models;
using TimePlanner.API.Services;
using TimePlanner.API.Middleware;
using TimePlanner.API.Utilities;
using TimePlanner.API.Utilities.Json;
using Serilog;
using FluentValidation;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using TimePlanner.API.Behaviors;

var builder = WebApplication.CreateBuilder(args);

// Secrets (JWT signing key, Postmark token) live in a gitignored appsettings.Secrets.json next to
// appsettings.json (template: appsettings.Secrets.example.json). Environment variables are re-added
// afterwards so Azure App Settings and test overrides still take precedence over the file.
builder.Configuration
    .AddJsonFile("appsettings.Secrets.json", optional: true, reloadOnChange: true)
    .AddEnvironmentVariables();

// 1. SERILOG SETUP
builder.Host.UseSerilog((context, configuration) =>
    configuration.ReadFrom.Configuration(context.Configuration));

try
{
    Log.Information("Starting web application");

    // --- CONFIGURATION ---
    var jwtSettings = builder.Configuration.GetSection("JwtSettings");
    var secretKey = jwtSettings["Secret"];

    // Get Frontend URL from Azure Env Vars, fallback to localhost
    var frontendUrl = builder.Configuration["FrontendBaseUrl"] ?? "http://localhost:5173";

    // Define Allowed Origins for CORS (CRUCIAL FIX)
    var allowedOrigins = new[]
    {
        frontendUrl,                       // From Azure Env Var (https://avkrysset.no)
        "https://avkrysset.no",            // Hardcoded primary domain
        "https://www.avkrysset.no",        // WWW variant
        "http://localhost:5173"            // Local development
    };

    // --- SERVICES ---
    builder.Services.AddMediatR(cfg =>
    {
        cfg.RegisterServicesFromAssembly(typeof(Program).Assembly);
        // Runs the FluentValidation validators of every command/query before its handler.
        cfg.AddOpenBehavior(typeof(ValidationBehavior<,>));
    });

    // DATABASE SETUP WITH TRANSIENT FAULT HANDLING
    builder.Services.AddDbContext<ApplicationDbContext>(options =>
        options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection"),
            sqlServerOptions => sqlServerOptions.EnableRetryOnFailure(
                maxRetryCount: 5,                        // Retry up to 5 times
                maxRetryDelay: TimeSpan.FromSeconds(10), // Max wait between retries
                errorNumbersToAdd: null                  // Use default SQL error codes for transient faults
            )));

    // IDENTITY SETUP
    builder.Services.AddIdentity<User, IdentityRole<Guid>>(options =>
    {
        options.Password.RequireDigit = true;
        options.Password.RequiredLength = 8;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = true;
        options.User.RequireUniqueEmail = true;
    })
    .AddEntityFrameworkStores<ApplicationDbContext>()
    .AddDefaultTokenProviders();

    // AUTHENTICATION & JWT SETUP
    builder.Services.AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings["Issuer"],
            ValidAudience = jwtSettings["Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey!))
        };
    });

    // CUSTOM SERVICES
    builder.Services.Configure<PostmarkSettings>(builder.Configuration.GetSection("PostmarkSettings"));
    builder.Services.AddScoped<IEmailService, EmailService>();
    builder.Services.AddHttpContextAccessor();
    builder.Services.AddScoped<ICurrentUserService, CurrentUserService>();
    builder.Services.AddScoped<ITokenService, TokenService>();
    builder.Services.AddScoped<IOrganizationNotificationService, SignalROrganizationNotifier>();

    // CORS POLICY SETUP (CRUCIAL FIX)
    builder.Services.AddCors(options =>
    {
        options.AddPolicy("DefaultCorsPolicy", policy =>
        {
            policy.WithOrigins(allowedOrigins)
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials(); // Crucial for SignalR
        });
    });

    // API & VALIDATION SETUP
    builder.Services.AddControllers()
        .AddJsonOptions(options =>
        {
            options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
            // Every DateTime is a UTC instant on the wire: "yyyy-MM-ddTHH:mm:ss.fffZ".
            options.JsonSerializerOptions.Converters.Add(new UtcDateTimeJsonConverter());
        })
        .ConfigureApiBehaviorOptions(options =>
        {
            // Model-binding failures (malformed JSON, unparseable values, missing required fields) use the
            // same { message, errors } body as every other API error instead of ValidationProblemDetails.
            options.InvalidModelStateResponseFactory = context =>
            {
                var errors = context.ModelState
                    .Where(entry => entry.Value is { Errors.Count: > 0 })
                    .SelectMany(entry => entry.Value!.Errors.Select(error =>
                        string.IsNullOrWhiteSpace(error.ErrorMessage) ? $"'{entry.Key}' is invalid." : error.ErrorMessage))
                    .Distinct()
                    .ToList();
                return new BadRequestObjectResult(new
                {
                    message = "Some of the submitted values are missing or invalid.",
                    errors
                });
            };
        });
    // Validators run once, in the MediatR ValidationBehavior (registered above). MVC auto-validation is
    // not enabled: it would validate commands bound from the body a second time and answer with a
    // different error shape (ValidationProblemDetails).
    builder.Services.AddValidatorsFromAssemblyContaining<Program>();
    builder.Services.AddEndpointsApiExplorer();

    // SWAGGER SETUP
    builder.Services.AddSwaggerGen(options =>
    {
        options.SwaggerDoc("v1", new OpenApiInfo { Title = "Time Planner API", Version = "v1" });
        options.CustomSchemaIds(type => type.FullName);
        options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
        {
            In = ParameterLocation.Header,
            Description = "Enter JWT",
            Name = "Authorization",
            Type = SecuritySchemeType.Http,
            BearerFormat = "JWT",
            Scheme = "Bearer"
        });
        options.AddSecurityRequirement(new OpenApiSecurityRequirement
        {
            {
                new OpenApiSecurityScheme
                {
                    Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
                },
                Array.Empty<string>()
            }
        });
    });

    // SIGNALR SETUP
    builder.Services.AddSignalR()
        .AddJsonProtocol(options =>
            options.PayloadSerializerOptions.Converters.Add(new UtcDateTimeJsonConverter()));

    // ==========================================
    // --- PIPELINE & MIDDLEWARE CONFIGURATION ---
    // ==========================================
    var app = builder.Build();

    // Time zone self-check: analytics bucket by the client's IANA zone (X-Time-Zone header).
    // If this host cannot resolve IANA ids, analytics silently fall back to UTC, so make it visible.
    foreach (var probeId in new[] { "Europe/Oslo", "Asia/Calcutta" })
    {
        if (TimeZoneResolver.TryResolve(probeId, out var probeZone))
        {
            app.Logger.LogInformation(
                "Time zone self-check: '{TimeZoneId}' resolved to '{ResolvedId}' (current UTC offset {Offset}).",
                probeId, probeZone.Id, probeZone.GetUtcOffset(DateTime.UtcNow));
        }
        else
        {
            app.Logger.LogWarning(
                "Time zone self-check: '{TimeZoneId}' could not be resolved; analytics for such clients will use UTC.",
                probeId);
        }
    }

    // 1. Forwarded Headers (CRITICAL FOR AZURE LINUX/WINDOWS PROXIES)
    app.UseForwardedHeaders(new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
    });

    // 2. Logging
    app.UseSerilogRequestLogging();

    // 3. Exception Handling (Keep Swagger enabled so we can debug if needed)
    if (app.Environment.IsDevelopment())
    {
        app.UseDeveloperExceptionPage();
    }
    app.UseSwagger();
    app.UseSwaggerUI();

    // Custom Exception Handler
    app.UseMiddleware<GlobalExceptionHandler>();

    // 4. Security & Routing
    app.UseHttpsRedirection();
    app.UseCors("DefaultCorsPolicy"); // Use the updated CORS policy

    // 5. Auth
    app.UseAuthentication();
    app.UseAuthorization();

    // 6. Map Endpoints
    app.MapControllers();
    app.MapHub<TimePlanner.API.Hubs.OrganizationHub>("/hubs/organization");

    app.Run();
}
catch (Exception ex) when (ex is not HostAbortedException) // HostAbortedException is the normal exit for EF design-time tools
{
    Log.Fatal(ex, "Application terminated unexpectedly");
}
finally
{
    Log.CloseAndFlush();
}

// Exposes the entry point to WebApplicationFactory<Program> in the integration tests.
public partial class Program { }
