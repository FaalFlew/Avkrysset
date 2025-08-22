using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Api.Models;
using Api.Models.Common;
using Api.Services;
using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore.Query;
namespace Api.Data;

public class ApplicationDbContext : IdentityDbContext<User, IdentityRole<Guid>, Guid>
{
    private readonly ICurrentUserService? _currentUserService;

    public ApplicationDbContext(
        DbContextOptions<ApplicationDbContext> options,
        ICurrentUserService? currentUserService = null) : base(options)
    {
        _currentUserService = currentUserService;
    }

    public DbSet<TaskItem> Tasks { get; set; } = null!;
    public DbSet<Category> Categories { get; set; } = null!;
    public DbSet<TaskTemplate> TaskTemplates { get; set; } = null!;

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        var currentUserId = _currentUserService?.UserId;

        foreach (var entry in ChangeTracker.Entries<AuditableEntity>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    entry.Entity.CreatedByUserId = currentUserId ?? Guid.Empty;
                    entry.Entity.CreatedOnUtc = DateTime.UtcNow;
                    entry.Entity.IsDeleted = false;
                    break;

                case EntityState.Modified:
                    var originalIsDeleted = entry.OriginalValues[nameof(AuditableEntity.IsDeleted)];
                    if (originalIsDeleted != null && entry.Entity.IsDeleted && originalIsDeleted.Equals(false))
                    {
                        entry.Entity.DeletedByUserId = currentUserId;
                        entry.Entity.DeletedOnUtc = DateTime.UtcNow;

                        entry.Entity.UpdatedByUserId = null;
                        entry.Entity.UpdatedOnUtc = null;
                    }
                    else if (!entry.Entity.IsDeleted)
                    {
                        entry.Entity.UpdatedByUserId = currentUserId;
                        entry.Entity.UpdatedOnUtc = DateTime.UtcNow;
                    }
                    break;
            }
        }

        return base.SaveChangesAsync(cancellationToken);
    }

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        Expression<Func<AuditableEntity, bool>> softDeleteFilter = e => !e.IsDeleted;

        foreach (var entityType in builder.Model.GetEntityTypes())
        {
            if (typeof(AuditableEntity).IsAssignableFrom(entityType.ClrType))
            {
                var parameter = Expression.Parameter(entityType.ClrType, "e");
                var body = ReplacingExpressionVisitor.Replace(
                    softDeleteFilter.Parameters.First(),
                    parameter,
                    softDeleteFilter.Body);
                var lambda = Expression.Lambda(body, parameter);

                builder.Entity(entityType.ClrType).HasQueryFilter(lambda);
            }
        }
        builder.Entity<User>(user =>
        {

            user.HasMany(u => u.Categories)
                .WithOne(c => c.User)
                .HasForeignKey(c => c.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            user.HasMany(u => u.TaskTemplates)
                .WithOne(tt => tt.User)
                .HasForeignKey(tt => tt.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            user.HasMany(u => u.Tasks)
                .WithOne(t => t.User)
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<Category>(category =>
        {
            category.HasKey(c => c.Id);
            category.Property(c => c.Name).IsRequired().HasMaxLength(100);
            category.Property(c => c.Color).IsRequired().HasMaxLength(7);

            category.HasIndex(c => new { c.UserId, c.Name }).IsUnique();
        });

        builder.Entity<TaskTemplate>(template =>
        {
            template.HasKey(t => t.Id);
            template.Property(t => t.Title).IsRequired().HasMaxLength(200);
            template.HasOne(t => t.Category)
                .WithMany()
                .HasForeignKey(t => t.CategoryId)
                .OnDelete(DeleteBehavior.NoAction);
        });


        builder.Entity<TaskItem>(task =>
        {
            task.HasKey(t => t.Id);
            task.Property(t => t.Title).IsRequired().HasMaxLength(200);

            task.HasOne(t => t.Category)
                .WithMany()
                .HasForeignKey(t => t.CategoryId)
                .OnDelete(DeleteBehavior.NoAction);
        });
    }
}