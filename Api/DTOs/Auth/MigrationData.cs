namespace Api.DTOs.Auth;


public class MigrationData
{
    public List<CategoryMigrationDto> Categories { get; set; } = new();
    public List<TaskTemplateMigrationDto> Templates { get; set; } = new();
    public List<TaskItemMigrationDto> Tasks { get; set; } = new();
}

public class CategoryMigrationDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
}

public class TaskTemplateMigrationDto
{
    public string Title { get; set; } = string.Empty;
    public double Duration { get; set; }
    public string CategoryId { get; set; } = string.Empty;
}

public class TaskItemMigrationDto
{
    public string Title { get; set; } = string.Empty;
    public string Start { get; set; } = string.Empty;
    public double Duration { get; set; }
    public string CategoryId { get; set; } = string.Empty;
    public string? TemplateId { get; set; }
}