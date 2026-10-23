using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using TimePlanner.API.Data;
using TimePlanner.API.Services;
using TimePlanner.API.Exceptions;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Models.Organization;

namespace TimePlanner.API.Features.Commands.Organizations;

public record CreateOrganizationCommand(string Name) : IRequest<OrganizationDto>;

public class CreateOrganizationCommandValidator : AbstractValidator<CreateOrganizationCommand>
{
    public CreateOrganizationCommandValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(150);
    }
}

public class CreateOrganizationCommandHandler : IRequestHandler<CreateOrganizationCommand, OrganizationDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public CreateOrganizationCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<OrganizationDto> Handle(CreateOrganizationCommand request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null)
        {
            throw new UnauthorizedAccessException();
        }

        // Rule: An organization name must be unique.
        var nameExists = await _context.Organizations.AnyAsync(o => o.Name == request.Name, cancellationToken);
        if (nameExists)
        {
            throw new ConflictException($"An organization with the name '{request.Name}' already exists.");
        }

        // The transaction ensures that creating the organization and adding the creator as the Owner
        // is an "all or nothing" atomic operation.
        await using var transaction = await _context.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var organization = new Organization
            {
                Name = request.Name,
                OwnerId = userId.Value,
                // Set codes to expire in 7 days by default.
                MemberJoinCode = GenerateJoinCode(),
                MemberJoinCodeExpiryUtc = DateTime.UtcNow.AddDays(7),
                AdminJoinCode = GenerateJoinCode(),
                AdminJoinCodeExpiryUtc = DateTime.UtcNow.AddDays(7)
            };
            _context.Organizations.Add(organization);
            await _context.SaveChangesAsync(cancellationToken);

            // The creator automatically becomes the first member with the 'Owner' role.
            var membership = new OrganizationMembership
            {
                OrganizationId = organization.Id,
                UserId = userId.Value,
                Role = OrganizationRoles.Owner,
                Status = MembershipStatus.Active
            };
            _context.OrganizationMemberships.Add(membership);
            await _context.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);

            return new OrganizationDto
            {
                Id = organization.Id,
                Name = organization.Name,
                OwnerId = organization.OwnerId,
                MemberJoinCode = organization.MemberJoinCode,
                MemberJoinCodeExpiryUtc = organization.MemberJoinCodeExpiryUtc,
                AdminJoinCode = organization.AdminJoinCode,
                AdminJoinCodeExpiryUtc = organization.AdminJoinCodeExpiryUtc
            };
        }
        catch (Exception)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw; // Re-throw the exception to be caught by the global handler.
        }
    }

    private static string GenerateJoinCode()
    {
        // Generates a random, 8-character alphanumeric code.
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I, O, 0, 1 for readability
        return new string(Enumerable.Repeat(chars, 8)
            .Select(s => s[RandomNumberGenerator.GetInt32(s.Length)]).ToArray());
    }
}