using MediatR;
using System.Security.Cryptography;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs.Organizations;
using TimePlanner.API.Services;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Features.Commands.Organizations;

// We return the OrganizationDto so the owner can immediately see the new codes.
public record RegenerateJoinCodesCommand(Guid OrganizationId, int ExpiryDays = 7) : IRequest<OrganizationDto>;

public class RegenerateJoinCodesCommandHandler : IRequestHandler<RegenerateJoinCodesCommand, OrganizationDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public RegenerateJoinCodesCommandHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<OrganizationDto> Handle(RegenerateJoinCodesCommand request, CancellationToken cancellationToken)
    {
        var currentUserId = _currentUserService.UserId;
        if (currentUserId == null) throw new UnauthorizedAccessException();

        // Authorization: Only the owner can regenerate codes.
        if (!await _context.IsOwner(currentUserId.Value, request.OrganizationId, cancellationToken))
        {
            throw new UnauthorizedAccessException("Only the organization owner can regenerate join codes.");
        }

        var organization = await _context.Organizations.FindAsync(new object[] { request.OrganizationId }, cancellationToken);
        if (organization == null) throw new KeyNotFoundException("Organization not found.");

        organization.MemberJoinCode = GenerateJoinCode();
        organization.MemberJoinCodeExpiryUtc = DateTime.UtcNow.AddDays(request.ExpiryDays);
        organization.AdminJoinCode = GenerateJoinCode();
        organization.AdminJoinCodeExpiryUtc = DateTime.UtcNow.AddDays(request.ExpiryDays);

        await _context.SaveChangesAsync(cancellationToken);

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

    private static string GenerateJoinCode()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        return new string(Enumerable.Repeat(chars, 8)
            .Select(s => s[RandomNumberGenerator.GetInt32(s.Length)]).ToArray());
    }
}