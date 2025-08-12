using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Api.Models;

namespace Api.Data;

public class ApplicationDbContext : IdentityDbContext<User, IdentityRole<Guid>, Guid>
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options)
    {
    }

    public DbSet<TaskItem> Tasks { get; set; } = null!;
    public DbSet<Category> Categories { get; set; } = null!;
    public DbSet<TaskTemplate> TaskTemplates { get; set; } = null!;


    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

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
                .OnDelete(DeleteBehavior.Restrict);
        });

        builder.Entity<TaskItem>(task =>
        {
            task.HasKey(t => t.Id);
            task.Property(t => t.Title).IsRequired().HasMaxLength(200);

            task.HasOne(t => t.Category)
                .WithMany()
                .HasForeignKey(t => t.CategoryId)
                .OnDelete(DeleteBehavior.Restrict);
        });
    }
}