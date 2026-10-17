using FluentValidation;
using TimePlanner.API.Features.Commands.Organizations;
using TimePlanner.API.Features.Commands.Users;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Models.Organization;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Tests.Unit;

public sealed class PhaseOneRulesTests
{
    private static readonly Guid Org = Guid.NewGuid();
    private static readonly Guid Me = Guid.NewGuid();
    private static readonly Guid SomeoneElse = Guid.NewGuid();

    [Theory]
    // personal task: edit + delete, nobody to reassign to
    [InlineData(false, "me", null, true, true, false)]
    // org task, viewer is Owner/Admin: everything
    [InlineData(true, "other", OrganizationRoles.Owner, true, true, true)]
    [InlineData(true, "other", OrganizationRoles.Admin, true, true, true)]
    [InlineData(true, "me", OrganizationRoles.Admin, true, true, true)]
    // org task a member created for themselves: edit + delete, no reassign
    [InlineData(true, "me", OrganizationRoles.Member, true, true, false)]
    // org task a member was only assigned: read-only
    [InlineData(true, "other", OrganizationRoles.Member, false, false, false)]
    // not an active member (left/removed): read-only
    [InlineData(true, "me", null, false, false, false)]
    public void Capabilities_follow_the_role_and_creator_rules(
        bool isOrgTask, string creator, string? viewerRole, bool canEdit, bool canDelete, bool canReassign)
    {
        var capabilities = TaskCapabilities.For(isOrgTask ? Org : null, creator == "me" ? Me : SomeoneElse, Me, viewerRole);

        Assert.Equal((canEdit, canDelete, canReassign), (capabilities.CanEdit, capabilities.CanDelete, capabilities.CanReassign));
    }

    [Fact]
    public void Organization_colors_are_deterministic_and_from_the_palette()
    {
        var id = Guid.Parse("6f9619ff-8b86-d011-b42d-00c04fc964ff");

        Assert.Equal(OrganizationPalette.ColorFor(id), OrganizationPalette.ColorFor(Guid.Parse(id.ToString())));
        Assert.Contains(OrganizationPalette.ColorFor(id), OrganizationPalette.Colors);
        Assert.DoesNotContain("#7D8590", OrganizationPalette.Colors); // Slate is reserved for "Other"

        // Different organizations spread over the palette.
        var used = Enumerable.Range(0, 200).Select(_ => OrganizationPalette.ColorFor(Guid.NewGuid())).Distinct().Count();
        Assert.True(used >= OrganizationPalette.Colors.Count - 1, $"only {used} colors used");
    }

    private static string[] Errors<T>(IValidator<T> validator, T instance) =>
        validator.Validate(instance).Errors.Select(e => e.ErrorMessage).ToArray();

    [Theory]
    [InlineData(1, true)]
    [InlineData(365, true)]
    [InlineData(0, false)]
    [InlineData(366, false)]
    [InlineData(int.MaxValue, false)]
    public void Join_codes_last_1_to_365_days(int days, bool valid)
    {
        var errors = Errors(new RegenerateJoinCodesCommandValidator(), new RegenerateJoinCodesCommand(Org, days));

        Assert.Equal(valid ? Array.Empty<string>() : new[] { "Join codes can be valid for 1 to 365 days." }, errors);
    }

    [Fact]
    public void Role_and_email_rules_report_one_message_per_field()
    {
        Assert.Equal(new[] { "Email is required.", "Role is required." },
            Errors(new InviteUserCommandValidator(), new InviteUserCommand(Org, "", "")));
        Assert.Equal(new[] { "A valid email address is required.", "Role must be 'Admin' or 'Member'." },
            Errors(new InviteUserCommandValidator(), new InviteUserCommand(Org, "nope", "Owner")));
        Assert.Equal(new[] { "Role is required." },
            Errors(new UpdateMemberRoleCommandValidator(), new UpdateMemberRoleCommand(Org, Me, "")));
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]          // clears the name
    [InlineData("   ", true)]       // clears the name
    [InlineData("Ada", true)]
    [InlineData("  padded  ", true)]
    public void Display_name_up_to_100_characters_after_trimming_is_accepted(string? name, bool valid)
    {
        Assert.Equal(valid, new UpdateMyProfileCommandValidator().Validate(new UpdateMyProfileCommand(name)).IsValid);
    }

    [Fact]
    public void Display_name_over_100_characters_is_rejected()
    {
        Assert.True(new UpdateMyProfileCommandValidator().Validate(new UpdateMyProfileCommand("  " + new string('a', 100) + "  ")).IsValid);
        Assert.Equal(new[] { "Display name can be at most 100 characters." },
            Errors(new UpdateMyProfileCommandValidator(), new UpdateMyProfileCommand(new string('a', 101))));
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("Europe/Oslo", true)]
    [InlineData("Asia/Calcutta", true)]
    [InlineData("UTC", true)]
    [InlineData("Nowhere/Zone", false)]
    [InlineData("Europe/Oslo; DROP", false)]
    public void Organization_time_zones_must_be_known(string? zone, bool valid)
    {
        Assert.Equal(valid, new CreateOrganizationCommandValidator().Validate(new CreateOrganizationCommand("Acme", zone)).IsValid);
        Assert.Equal(valid, new UpdateOrganizationCommandValidator().Validate(new UpdateOrganizationCommand(Org, "Acme", zone)).IsValid);
    }

    [Fact]
    public void Assignee_list_cannot_be_emptied()
    {
        Assert.Equal(new[] { "At least one assignee is required." },
            Errors(new UpdateTaskAssigneesCommandValidator(), new UpdateTaskAssigneesCommand(Org, Guid.NewGuid(), new List<Guid>())));
    }
}
