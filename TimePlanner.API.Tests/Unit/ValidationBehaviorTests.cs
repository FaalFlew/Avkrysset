using FluentValidation;
using MediatR;
using TimePlanner.API.Behaviors;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Commands.Auth;
using TimePlanner.API.Features.Commands.Categories;
using TimePlanner.API.Features.Commands.Organizations;
using TimePlanner.API.Features.Commands.Tasks;
using TimePlanner.API.Features.Commands.TaskTemplates;

namespace TimePlanner.API.Tests.Unit;

public sealed class ValidationBehaviorTests
{
    public sealed record Ping(string Name, int Count) : IRequest<string>;

    private sealed class NameValidator : AbstractValidator<Ping>
    {
        public NameValidator() => RuleFor(x => x.Name).NotEmpty().WithMessage("Name is required.");
    }

    private sealed class CountValidator : AbstractValidator<Ping>
    {
        public CountValidator()
        {
            RuleFor(x => x.Count).GreaterThan(0).WithMessage("Count must be positive.");
            RuleFor(x => x.Name).NotEmpty().WithMessage("Name is required.");
        }
    }

    private static Task<string> Run(Ping request, params IValidator<Ping>[] validators)
    {
        var behavior = new ValidationBehavior<Ping, string>(validators);
        return behavior.Handle(request, _ => Task.FromResult("handled"), CancellationToken.None);
    }

    [Fact]
    public async Task Valid_requests_reach_the_handler()
    {
        Assert.Equal("handled", await Run(new Ping("a", 1), new NameValidator(), new CountValidator()));
    }

    [Fact]
    public async Task Requests_without_validators_reach_the_handler()
    {
        Assert.Equal("handled", await Run(new Ping("", -1)));
    }

    [Fact]
    public async Task Failures_stop_the_request_with_a_readable_message_and_the_individual_errors()
    {
        var handled = false;
        var behavior = new ValidationBehavior<Ping, string>(new IValidator<Ping>[] { new NameValidator(), new CountValidator() });

        var ex = await Assert.ThrowsAsync<BadRequestException>(() => behavior.Handle(
            new Ping("", 0),
            _ => { handled = true; return Task.FromResult("handled"); },
            CancellationToken.None));

        Assert.False(handled);
        // Same failure from two validators is reported once.
        Assert.Equal("Name is required. Count must be positive.", ex.Message);
        Assert.Equal(new[] { "Name is required.", "Count must be positive." }, ex.Errors);
    }

    // --- The audited validators ---

    private static string[] Errors<T>(AbstractValidator<T> validator, T instance) =>
        validator.Validate(instance).Errors.Select(e => e.ErrorMessage).ToArray();

    private static readonly DateTime Start = new(2026, 10, 13, 8, 0, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData(0, TaskRules.DurationMustBePositive)]
    [InlineData(-1, TaskRules.DurationMustBePositive)]
    [InlineData(24.01, TaskRules.DurationTooLong)]
    [InlineData(1000000, TaskRules.DurationTooLong)]
    public void Task_durations_outside_0_to_24_hours_are_rejected(double duration, string message)
    {
        var create = new CreateTaskCommand("Plan", Start, duration, Guid.NewGuid(), null);
        var update = new UpdateTaskCommand(Guid.NewGuid(), "Plan", Start, duration, Guid.NewGuid(), null);
        var orgTask = new CreateOrganizationTaskCommand(Guid.NewGuid(), "Plan", Start, duration, Guid.NewGuid(), new List<Guid> { Guid.NewGuid() });
        var template = new CreateTaskTemplateCommand("Plan", duration, Guid.NewGuid());

        Assert.Equal(new[] { message }, Errors(new CreateTaskCommandValidator(), create));
        Assert.Equal(new[] { message }, Errors(new UpdateTaskCommandValidator(), update));
        Assert.Equal(new[] { message }, Errors(new CreateOrganizationTaskCommandValidator(), orgTask));
        Assert.Equal(new[] { message }, Errors(new CreateTaskTemplateCommandValidator(), template));
    }

    [Theory]
    [InlineData(24)]
    [InlineData(1.0 / 60)]
    [InlineData(0.25)]
    [InlineData(7.5)]
    public void Task_durations_the_planner_produces_are_accepted(double duration)
    {
        Assert.Empty(Errors(new CreateTaskCommandValidator(), new CreateTaskCommand("Plan", Start, duration, Guid.NewGuid(), null)));
        Assert.Empty(Errors(new UpdateTaskTemplateCommandValidator(), new UpdateTaskTemplateCommand(Guid.NewGuid(), "Plan", duration, Guid.NewGuid())));
    }

    [Fact]
    public void Task_titles_are_required_but_unlimited_and_template_titles_stop_at_200()
    {
        Assert.Equal(new[] { TaskRules.TitleRequired },
            Errors(new CreateTaskCommandValidator(), new CreateTaskCommand("  ", Start, 1, Guid.NewGuid(), null)));
        Assert.Empty(Errors(new CreateTaskCommandValidator(), new CreateTaskCommand(new string('t', 10_000), Start, 1, Guid.NewGuid(), null)));
        Assert.Empty(Errors(new UpdateOrganizationTaskCommandValidator(),
            new UpdateOrganizationTaskCommand(Guid.NewGuid(), Guid.NewGuid(), new string('t', 10_000), Start, 1, Guid.NewGuid())));

        Assert.Empty(Errors(new CreateTaskTemplateCommandValidator(), new CreateTaskTemplateCommand(new string('t', 200), 1, Guid.NewGuid())));
        Assert.Equal(new[] { "Template title can be at most 200 characters." },
            Errors(new CreateTaskTemplateCommandValidator(), new CreateTaskTemplateCommand(new string('t', 201), 1, Guid.NewGuid())));
    }

    [Theory]
    [InlineData("#2F7FE0", null)]
    [InlineData("#2f7fe0", null)]
    [InlineData("", "Color is required.")]
    [InlineData("#abc", "Color must be a hex color like #2F7FE0.")]
    [InlineData("2F7FE0", "Color must be a hex color like #2F7FE0.")]
    [InlineData("#2F7FE0FF", "Color must be a hex color like #2F7FE0.")]
    public void Category_colors_must_be_RRGGBB(string color, string? message)
    {
        var errors = Errors(new CreateCategoryCommandValidator(), new CreateCategoryCommand("Gym", color));

        Assert.Equal(message is null ? Array.Empty<string>() : new[] { message }, errors);
    }

    [Theory]
    [InlineData("", "Password is required.")]
    [InlineData("short", "Password must be at least 8 characters long.")]
    [InlineData("alllowercase1!", "Password must contain at least one uppercase letter.")]
    [InlineData("Valid-Passw0rd", null)]
    public void Register_reports_the_first_password_problem_only(string password, string? message)
    {
        var errors = Errors(new RegisterCommandValidator(), new RegisterCommand("someone@example.com", password, null));

        Assert.Equal(message is null ? Array.Empty<string>() : new[] { message }, errors);
    }
}
