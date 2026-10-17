namespace TimePlanner.API.Features.Commands.Tasks;

/// <summary>
/// Limits shared by the task, task template and organization task validators. They match the planner UI:
/// resizing stops at 24 hours and an end time equal to the start means "+1 day", so a task is at most 24 hours.
/// Durations are fractional hours; the editor works in whole minutes, so no step is enforced.
/// </summary>
public static class TaskRules
{
    public const double MaxDurationHours = 24;

    public const string TitleRequired = "Title is required.";
    public const string StartRequired = "Start time is required.";
    public const string CategoryRequired = "Category is required.";
    public const string DurationMustBePositive = "Duration must be greater than 0 hours.";
    public const string DurationTooLong = "Duration can't be longer than 24 hours.";
}
