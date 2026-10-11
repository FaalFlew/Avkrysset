using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Models;
using TimePlanner.API.Models.Common;
using TimePlanner.API.Services;
using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore.Query;
using TimePlanner.API.Models.Organization;
namespace TimePlanner.API.Data;

// We inherit from IdentityDbContext. This automatically sets up the DbSets
// for all of ASP.NET Core Identity's tables (Users, Roles, Claims, etc.).
// We specify our custom User class and use Guid as the key type.
public class ApplicationDbContext : IdentityDbContext<User, IdentityRole<Guid>, Guid>
{
    private readonly ICurrentUserService? _currentUserService; // Make it nullable to handle design-time scenarios

    public ApplicationDbContext(
        DbContextOptions<ApplicationDbContext> options,
        ICurrentUserService? currentUserService = null) : base(options)
    {
        _currentUserService = currentUserService;
    }

    // Our custom DbSets for the application's entities.
    // EF Core will use these to create the tables.
    public DbSet<TaskItem> Tasks { get; set; } = null!;
    public DbSet<Category> Categories { get; set; } = null!;
    public DbSet<TaskTemplate> TaskTemplates { get; set; } = null!;

    // --- ADD THESE NEW DBSETS ---
    public DbSet<Organization> Organizations { get; set; } = null!;
    public DbSet<OrganizationMembership> OrganizationMemberships { get; set; } = null!;
    public DbSet<TaskAssignment> TaskAssignments { get; set; } = null!;
    public DbSet<IssuePanel> IssuePanels { get; set; } = null!;
    public DbSet<Issue> Issues { get; set; } = null!;
    public DbSet<OrganizationInvitation> OrganizationInvitations { get; set; } = null!;


    // 3. Add the SaveChangesAsync override back. This is the centralized audit logic.
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
                    // --- FIX FOR WARNING CS8602 ---
                    // We must check if OriginalValues is not null before accessing it.
                    var originalIsDeleted = entry.OriginalValues[nameof(AuditableEntity.IsDeleted)];
                    if (originalIsDeleted != null && entry.Entity.IsDeleted && originalIsDeleted.Equals(false))
                    {
                        // This is a soft delete operation.
                        entry.Entity.DeletedByUserId = currentUserId;
                        entry.Entity.DeletedOnUtc = DateTime.UtcNow;

                        // We don't want to set the "Updated" fields when deleting.
                        entry.Entity.UpdatedByUserId = null;
                        entry.Entity.UpdatedOnUtc = null;
                    }
                    else if (!entry.Entity.IsDeleted)
                    {
                        // This is a regular update operation.
                        entry.Entity.UpdatedByUserId = currentUserId;
                        entry.Entity.UpdatedOnUtc = DateTime.UtcNow;
                    }
                    break;
            }
        }

        return base.SaveChangesAsync(cancellationToken);
    }
    // This method is our central hub for configuring the database model
    // using the Fluent API. It's more powerful and flexible than data annotations.
    protected override void OnModelCreating(ModelBuilder builder)
    {
        // It's crucial to call the base method. It configures the Identity schema.
        base.OnModelCreating(builder);

        // --- FIX FOR ERROR CS8917 ---
        // We create a reusable lambda expression with an explicit type.
        Expression<Func<AuditableEntity, bool>> softDeleteFilter = e => !e.IsDeleted;

        foreach (var entityType in builder.Model.GetEntityTypes())
        {
            if (typeof(AuditableEntity).IsAssignableFrom(entityType.ClrType))
            {
                // To apply the filter, we need to build a new lambda expression
                // that works with the specific entity type (e.g., Category, TaskItem)
                // but uses the logic from our master filter.
                var parameter = Expression.Parameter(entityType.ClrType, "e");
                var body = ReplacingExpressionVisitor.Replace(
                    softDeleteFilter.Parameters.First(),
                    parameter,
                    softDeleteFilter.Body);
                var lambda = Expression.Lambda(body, parameter);

                builder.Entity(entityType.ClrType).HasQueryFilter(lambda);
            }
        }
        // --- Configure the User Entity Relationships ---
        builder.Entity<User>(user =>
        {
            // A user can have many Categories. If the user is deleted,
            // all their associated categories are also deleted (Cascade).
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

            user.HasMany(u => u.OrganizationMemberships)
                .WithOne(om => om.User)
                .HasForeignKey(om => om.UserId)
                .OnDelete(DeleteBehavior.Cascade); // If a user is deleted, their memberships are gone.
        });



        // --- Configure the Category Entity ---
        builder.Entity<Category>(category =>
        {
            category.HasKey(c => c.Id);
            category.Property(c => c.Name).IsRequired().HasMaxLength(100);
            category.Property(c => c.Color).IsRequired().HasMaxLength(7);

            // Create a unique index on (UserId, Name). This prevents a single
            // user from creating two categories with the exact same name.
            category.HasIndex(c => new { c.UserId, c.Name }).IsUnique();
        });

        // --- Configure the TaskTemplate Entity ---
        builder.Entity<TaskTemplate>(template =>
        {
            template.HasKey(t => t.Id);
            template.Property(t => t.Title).IsRequired().HasMaxLength(200);

            // A TaskTemplate has one Category.
            // If the Category is deleted, we must handle the templates.
            // Restrict prevents the category from being deleted if templates are linked.
            // This enforces the data integrity rule from your original requirements.
            template.HasOne(t => t.Category)
                .WithMany() // A category can be associated with many templates
                .HasForeignKey(t => t.CategoryId)
                .OnDelete(DeleteBehavior.NoAction);
        });

        // --- Configure the TaskItem Entity ---
        builder.Entity<TaskItem>(task =>
        {
            task.HasKey(t => t.Id);
            task.Property(t => t.Title).IsRequired();

            // Similar to templates, a TaskItem has one Category.
            // Deleting the category is restricted if tasks depend on it.
            task.HasOne(t => t.Category)
                .WithMany() // A category can be associated with many tasks
                .HasForeignKey(t => t.CategoryId)
                .OnDelete(DeleteBehavior.NoAction);

            task.HasOne(t => t.Organization)
                .WithMany() // An org can have many tasks
                .HasForeignKey(t => t.OrganizationId)
                .OnDelete(DeleteBehavior.Cascade); // If org is deleted, its tasks are deleted.

            // Configure the many-to-many relationship with User through TaskAssignment
            task.HasMany(t => t.Assignments)
                .WithOne(a => a.TaskItem)
                .HasForeignKey(a => a.TaskItemId)
                .OnDelete(DeleteBehavior.Cascade); // If a task is deleted, its assignments are deleted.
        });

        // --- Configure the TaskAssignment Entity ---
        builder.Entity<TaskAssignment>(assignment =>
        {
            assignment.HasKey(a => a.Id);

            // A specific user can only be assigned to a specific task once.
            assignment.HasIndex(a => new { a.TaskItemId, a.AssigneeId }).IsUnique();

            // Define the relationship to the User (Assignee)
            assignment.HasOne(a => a.Assignee)
                .WithMany() // A user can have many task assignments
                .HasForeignKey(a => a.AssigneeId)
                .OnDelete(DeleteBehavior.Restrict); // Don't delete a user if they have tasks assigned.
        });

        // --- Configure the Organization Entity ---
        builder.Entity<Organization>(org =>
        {
            org.HasKey(o => o.Id);

            // An organization must have a unique name.
            org.HasIndex(o => o.Name).IsUnique();

            // The join codes must be unique across all organizations.
            org.HasIndex(o => o.MemberJoinCode).IsUnique();
            org.HasIndex(o => o.AdminJoinCode).IsUnique();

            // An organization is owned by one User.
            // Restrict deletion: an Organization cannot be deleted if the Owner User still exists.
            // The user must be deleted first, or ownership transferred.
            org.HasOne(o => o.Owner)
               .WithMany()
               .HasForeignKey(o => o.OwnerId)
               .OnDelete(DeleteBehavior.Restrict);

            // An organization has many memberships. If the org is deleted, all memberships are deleted.
            org.HasMany(o => o.Memberships)
                .WithOne(om => om.Organization)
                .HasForeignKey(om => om.OrganizationId)
                .OnDelete(DeleteBehavior.Cascade);

            org.HasMany(o => o.IssuePanels)
                .WithOne(ip => ip.Organization)
                .HasForeignKey(ip => ip.OrganizationId)
                .OnDelete(DeleteBehavior.Cascade); // If org is deleted, its panels are deleted.
        });

        // --- Configure the IssuePanel Entity ---
        builder.Entity<IssuePanel>(panel =>
        {
            panel.HasKey(p => p.Id);

            // A panel name should be unique within its organization.
            panel.HasIndex(p => new { p.OrganizationId, p.Name }).IsUnique();

            // An IssuePanel has many Issues. If the panel is deleted, all its issues are deleted.
            panel.HasMany(p => p.Issues)
                 .WithOne(i => i.IssuePanel)
                 .HasForeignKey(i => i.IssuePanelId)
                 .OnDelete(DeleteBehavior.Cascade);
        });

        // --- Configure the Issue Entity ---
        builder.Entity<Issue>(issue =>
        {
            issue.HasKey(i => i.Id);

            // An issue belongs to one category. If the category is deleted, restrict.
            issue.HasOne(i => i.Category)
                 .WithMany()
                 .HasForeignKey(i => i.CategoryId)
                 .OnDelete(DeleteBehavior.Restrict);

            // An issue belongs to one organization.
            issue.HasOne(i => i.Organization)
                 .WithMany()
                 .HasForeignKey(i => i.OrganizationId)
                 .OnDelete(DeleteBehavior.ClientCascade); // Use ClientCascade to avoid multiple cascade paths error.
        });

        // --- Configure the OrganizationInvitation Entity ---
        builder.Entity<OrganizationInvitation>(invite =>
        {
            invite.HasKey(i => i.Id);

            // --- New configurations moved from annotations ---
            invite.Property(i => i.InvitedUserEmail).IsRequired().HasMaxLength(256);
            invite.Property(i => i.Role).IsRequired();
            invite.Property(i => i.Status).IsRequired();
            invite.Property(i => i.Token).IsRequired();

            // --- Existing configurations ---
            invite.HasIndex(i => new { i.OrganizationId, i.InvitedUserEmail, i.Status }).IsUnique()
                .HasFilter($"[{nameof(OrganizationInvitation.Status)}] = '{InvitationStatus.Pending}'");

            invite.HasIndex(i => i.Token).IsUnique();

            invite.HasOne(i => i.Organization)
                .WithMany()
                .HasForeignKey(i => i.OrganizationId)
                .OnDelete(DeleteBehavior.Cascade);

            invite.HasOne(i => i.Inviter)
                .WithMany()
                .HasForeignKey(i => i.InviterId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        // --- Configure the OrganizationMembership Entity ---
        builder.Entity<OrganizationMembership>(membership =>
        {
            membership.HasKey(m => m.Id);

            // A user can only be in a specific organization once.
            // This creates a composite unique index.
            membership.HasIndex(m => new { m.OrganizationId, m.UserId }).IsUnique();
        });
    }
}