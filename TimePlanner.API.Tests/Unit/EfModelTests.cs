using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using TimePlanner.API.Data;
using TimePlanner.API.Data.Converters;
using TimePlanner.API.Features.Commands.Tasks;
using TimePlanner.API.Models;
using Xunit.Abstractions;

namespace TimePlanner.API.Tests.Unit;

/// <summary>
/// Model and SQL-generation checks. They build the EF model and generate SQL only;
/// no database connection is ever opened.
/// </summary>
public sealed class EfModelTests
{
    private readonly ITestOutputHelper _output;

    public EfModelTests(ITestOutputHelper output) => _output = output;

    private static ApplicationDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlServer(@"Server=(localdb)\MSSQLLocalDB;Database=TimePlannerDb_ModelOnly;Trusted_Connection=True;")
            .Options);

    [Fact]
    public void Every_DateTime_property_has_the_utc_converter()
    {
        using var context = CreateContext();

        var dateTimeProperties = context.Model.GetEntityTypes()
            .SelectMany(e => e.GetProperties())
            .Where(p => p.ClrType == typeof(DateTime) || p.ClrType == typeof(DateTime?))
            .ToList();

        Assert.NotEmpty(dateTimeProperties);
        foreach (var property in dateTimeProperties)
        {
            var storeType = property.GetRelationalTypeMapping().StoreType;
            _output.WriteLine($"{property.DeclaringType.DisplayName()}.{property.Name} ({property.ClrType.Name}) -> {storeType}");
            Assert.IsType<UtcDateTimeValueConverter>(property.GetValueConverter());
            Assert.Equal("datetime2", storeType); // unchanged store type => no migration
        }

        Assert.Contains(dateTimeProperties, p => p.Name == nameof(TaskItem.Start));
        Assert.Contains(dateTimeProperties, p => p.Name == "UpdatedOnUtc" && p.ClrType == typeof(DateTime?));
        Assert.Contains(dateTimeProperties, p => p.Name == nameof(User.RefreshTokenExpiryTime));
    }

    [Fact]
    public void Converter_never_stores_local_time_and_reads_back_utc()
    {
        ValueConverter<DateTime, DateTime> converter = new UtcDateTimeValueConverter();
        var toProvider = converter.ConvertToProviderExpression.Compile();
        var fromProvider = converter.ConvertFromProviderExpression.Compile();
        var utc = new DateTime(2026, 10, 3, 7, 0, 0, DateTimeKind.Utc);

        Assert.Equal(utc, toProvider(utc));
        Assert.Equal(utc, toProvider(utc.ToLocalTime()));
        Assert.Equal(utc.Ticks, toProvider(DateTime.SpecifyKind(utc, DateTimeKind.Unspecified)).Ticks);

        var read = fromProvider(DateTime.SpecifyKind(utc, DateTimeKind.Unspecified));
        Assert.Equal(DateTimeKind.Utc, read.Kind);
        Assert.Equal(utc, read);
    }

    [Fact]
    public void Overlap_check_translates_to_second_precision_DATEADD()
    {
        using var context = CreateContext();
        var start = new DateTime(2026, 10, 7, 10, 0, 0, DateTimeKind.Utc);

        var sql = context.Tasks
            .Where(t => t.UserId == Guid.Empty)
            .Where(TaskOverlap.Overlaps(start, TaskOverlap.EndOf(start, 0.5)))
            .ToQueryString();
        _output.WriteLine(sql);

        Assert.Contains("DATEADD(second, CAST(ROUND([t].[Duration] * 3600.0E0, 0) AS int), [t].[Start])", sql);
        Assert.DoesNotContain("DATEADD(hour", sql);
    }

    [Fact]
    public void TaskOverlap_end_is_rounded_to_whole_seconds()
    {
        var start = new DateTime(2026, 10, 7, 9, 0, 0, DateTimeKind.Utc);

        Assert.Equal(start.AddMinutes(90), TaskOverlap.EndOf(start, 1.5));
        Assert.Equal(start.AddMinutes(15), TaskOverlap.EndOf(start, 0.25));
        Assert.Equal(start.AddMinutes(20), TaskOverlap.EndOf(start, 1d / 3));
    }
}
