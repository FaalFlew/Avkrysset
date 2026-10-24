using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Commands.Users;

// DisplayName is trimmed; empty or whitespace clears it (others then see the email).
public record UpdateMyProfileCommand(string? DisplayName) : IRequest<UserProfileDto>;

public class UpdateMyProfileCommandValidator : AbstractValidator<UpdateMyProfileCommand>
{
    public const int MaxDisplayNameLength = 100;

    public UpdateMyProfileCommandValidator()
    {
        RuleFor(x => x.DisplayName)
            .Must(name => name is null || name.Trim().Length <= MaxDisplayNameLength)
            .WithMessage($"Display name can be at most {MaxDisplayNameLength} characters.");
    }
}

public class UpdateMyProfileCommandHandler : IRequestHandler<UpdateMyProfileCommand, UserProfileDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public UpdateMyProfileCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<UserProfileDto> Handle(UpdateMyProfileCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        var user = await _context.Users.SingleOrDefaultAsync(u => u.Id == userId, cancellationToken)
                   ?? throw new UnauthorizedAccessException(); // the token's user no longer exists

        var trimmed = request.DisplayName?.Trim();
        user.DisplayName = string.IsNullOrEmpty(trimmed) ? null : trimmed;
        await _context.SaveChangesAsync(cancellationToken);

        return new UserProfileDto { Id = user.Id, Email = user.Email!, DisplayName = user.DisplayName };
    }
}
