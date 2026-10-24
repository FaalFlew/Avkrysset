using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TimePlanner.API.Data;
using TimePlanner.API.Models;
using TimePlanner.API.Services;

namespace TimePlanner.API.Tests.Integration;

[CollectionDefinition(Name)]
public sealed class ApiCollection : ICollectionFixture<ApiFixture>
{
    public const string Name = "API on LocalDB";
}

/// <summary>
/// Hosts the real API (Program) in memory against a throwaway LocalDB database.
/// The database is created with the app's migrations and deleted again when the run ends.
/// Program reads JWT settings and the connection string before Build(), so they are supplied
/// as process environment variables (which override appsettings.json) and restored afterwards.
/// </summary>
public sealed class ApiFixture : IAsyncLifetime
{
    public const string Password = "Test-Passw0rd!";
    private const string LocalDbInstance = "MSSQLLocalDB";

    private readonly Dictionary<string, string?> _previousEnvironment = new();
    private bool _databaseCreated;

    public ApiFixture()
    {
        DatabaseName = $"TimePlannerDb_Test_{Guid.NewGuid():N}";
        ConnectionString =
            $@"Server=(localdb)\{LocalDbInstance};Database={DatabaseName};Trusted_Connection=True;" +
            "TrustServerCertificate=True;MultipleActiveResultSets=False;Connect Timeout=60;";
    }

    public string DatabaseName { get; }
    public string ConnectionString { get; }
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;

    /// <summary>Records the real-time notifications the API sends (replaces the SignalR notifier).</summary>
    public RecordingNotificationService Notifications { get; } = new();

    /// <summary>Lets a test make a chosen SaveChanges call fail inside the API.</summary>
    public FaultInjectionInterceptor Faults { get; } = new();

    /// <summary>Counts SQL commands sent by the API while a window is open.</summary>
    public SqlCommandCounter SqlCommands { get; } = new();

    /// <summary>The API's TimeProvider: real time unless a test shifts it.</summary>
    public TestClock Clock { get; } = new();

    public async Task InitializeAsync()
    {
        EnsureLocalDb(ConnectionString);
        await LocalDbInstanceHelper.EnsureStartedAsync(LocalDbInstance);

        SetEnvironment("ConnectionStrings__DefaultConnection", ConnectionString);
        SetEnvironment("JwtSettings__Secret", "integration-tests-only-signing-key-0123456789abcdefghijklmnopqrstuvwxyz");
        SetEnvironment("JwtSettings__Issuer", "https://timeplanner.tests/");
        SetEnvironment("JwtSettings__Audience", "https://timeplanner.tests/");

        Factory = new TestApiFactory(Notifications, Faults, SqlCommands, Clock);

        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();

        // Guard against ever migrating (or later deleting) anything but a LocalDB test database.
        var effective = db.Database.GetConnectionString();
        EnsureLocalDb(effective);
        if (!effective!.Contains(DatabaseName, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("The API did not pick up the test connection string.");
        }

        _databaseCreated = true;
        await LocalDbInstanceHelper.RetryAsync(() => db.Database.MigrateAsync());
    }

    public async Task DisposeAsync()
    {
        try
        {
            if (Factory is not null && _databaseCreated)
            {
                using var scope = Factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
                EnsureLocalDb(db.Database.GetConnectionString());
                SqlConnection.ClearAllPools();
                await db.Database.EnsureDeletedAsync();
            }
        }
        finally
        {
            Factory?.Dispose();
            SqlConnection.ClearAllPools();
            foreach (var (name, value) in _previousEnvironment)
            {
                Environment.SetEnvironmentVariable(name, value);
            }
        }
    }

    public IServiceScope CreateScope() => Factory.Services.CreateScope();

    /// <summary>Creates a confirmed user with one category and returns a client authenticated as that user.</summary>
    public async Task<TestUser> CreateUserAsync()
    {
        var email = $"user-{Guid.NewGuid():N}@tests.local";
        Guid userId;
        Guid categoryId;

        using (var scope = CreateScope())
        {
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var user = new User { UserName = email, Email = email, EmailConfirmed = true };
            var created = await userManager.CreateAsync(user, Password);
            Assert.True(created.Succeeded, string.Join(", ", created.Errors.Select(e => e.Description)));

            var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
            var category = new Category { Name = "Work", Color = "#3366FF", UserId = user.Id };
            db.Categories.Add(category);
            await db.SaveChangesAsync();

            userId = user.Id;
            categoryId = category.Id;
        }

        var client = Factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/auth/login", new { email, password = Password });
        Assert.True(login.IsSuccessStatusCode, await login.Content.ReadAsStringAsync());
        using var body = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        var token = body.RootElement.GetProperty("accessToken").GetString();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        return new TestUser(userId, email, categoryId, client);
    }

    private static void EnsureLocalDb(string? connectionString)
    {
        if (connectionString is null || !connectionString.Contains("localdb", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                "Integration tests only run against SQL Server LocalDB. Refusing to use: " + connectionString);
        }
    }

    private void SetEnvironment(string name, string value)
    {
        if (!_previousEnvironment.ContainsKey(name))
        {
            _previousEnvironment[name] = Environment.GetEnvironmentVariable(name);
        }

        Environment.SetEnvironmentVariable(name, value);
    }

    private sealed class TestApiFactory(
        RecordingNotificationService notifications,
        FaultInjectionInterceptor faults,
        SqlCommandCounter sqlCommands,
        TestClock clock) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IEmailService>();
                services.AddScoped<IEmailService, NoOpEmailService>();

                services.RemoveAll<IOrganizationNotificationService>();
                services.AddSingleton<IOrganizationNotificationService>(notifications);

                // Adds the interceptor on top of the app's own UseSqlServer(...) configuration.
                services.ConfigureDbContext<ApplicationDbContext>(options => options.AddInterceptors(faults, sqlCommands));

                services.AddSingleton<IStartupFilter, TestClientIp.StartupFilter>();

                services.RemoveAll<TimeProvider>();
                services.AddSingleton<TimeProvider>(clock);
            });
        }
    }

    private sealed class NoOpEmailService : IEmailService
    {
        public Task<bool> SendEmailAsync(string toEmail, string subject, string htmlContent) => Task.FromResult(true);
    }
}

public sealed record TestUser(Guid Id, string Email, Guid CategoryId, HttpClient Client);

/// <summary>
/// TestServer requests have no client IP. A test can pick one with the <see cref="Header"/> request header (test host
/// only), e.g. to exercise per-IP rate limits without sharing a partition with other tests.
/// </summary>
public static class TestClientIp
{
    public const string Header = "X-Test-Client-Ip";

    private static int _next;

    /// <summary>A new address from 10.77.0.0/16 for each call.</summary>
    public static string Unique()
    {
        var n = Interlocked.Increment(ref _next);
        return $"10.77.{(n >> 8) & 0xFF}.{n & 0xFF}";
    }

    internal sealed class StartupFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((context, nextMiddleware) =>
            {
                if (IPAddress.TryParse(context.Request.Headers[Header].ToString(), out var address))
                {
                    context.Connection.RemoteIpAddress = address;
                }

                return nextMiddleware(context);
            });
            next(app);
        };
    }
}

/// <summary>
/// LocalDB starts its instance on demand, and the first start after boot can be slow or fail
/// transiently. Start it explicitly and retry the first database operations.
/// </summary>
internal static class LocalDbInstanceHelper
{
    public static async Task EnsureStartedAsync(string instance)
    {
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                using var process = Process.Start(new ProcessStartInfo("sqllocaldb", $"start \"{instance}\"")
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
                if (process is null)
                {
                    return;
                }

                await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(90));
                if (process.ExitCode == 0)
                {
                    return;
                }
            }
            catch (System.ComponentModel.Win32Exception)
            {
                // sqllocaldb.exe is not on PATH; the instance will be auto-started by the first connection.
                return;
            }
            catch (TimeoutException)
            {
                // Fall through to retry.
            }

            await Task.Delay(TimeSpan.FromSeconds(2 * attempt));
        }
        // Even if "start" kept failing, the connection attempts below are retried as well.
    }

    public static async Task RetryAsync(Func<Task> operation, int attempts = 4)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await operation();
                return;
            }
            catch (Exception ex) when (attempt < attempts && (ex is SqlException || ex.InnerException is SqlException))
            {
                SqlConnection.ClearAllPools();
                await Task.Delay(TimeSpan.FromSeconds(3 * attempt));
            }
        }
    }
}
