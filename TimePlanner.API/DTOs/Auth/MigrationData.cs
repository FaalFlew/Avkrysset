namespace TimePlanner.API.DTOs.Auth;

// This class and its children mirror the structure of your Vue app's
// localStorage data. This makes it easy for the frontend to serialize
// its state and send it to us.

public class MigrationData
{
    public List<CategoryMigrationDto> Categories { get; set; } = new();
    public List<TaskTemplateMigrationDto> Templates { get; set; } = new();
    public List<TaskItemMigrationDto> Tasks { get; set; } = new();
}

public class CategoryMigrationDto
{
    public string Id { get; set; } = string.Empty; // The old string ID from the frontend
    public string Name { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
}

public class TaskTemplateMigrationDto
{
    public string Id { get; set; } = string.Empty; // <<< ADD THIS FIELD
    public string Title { get; set; } = string.Empty;
    public double Duration { get; set; }
    public string CategoryId { get; set; } = string.Empty;
}

public class TaskItemMigrationDto
{
    public string Title { get; set; } = string.Empty;
    public string Start { get; set; } = string.Empty; // ISO 8601 string from frontend
    public double Duration { get; set; }
    public string CategoryId { get; set; } = string.Empty; // Refers to old string ID
    public string? TemplateId { get; set; } // We won't use this in migration, but include for completeness
}