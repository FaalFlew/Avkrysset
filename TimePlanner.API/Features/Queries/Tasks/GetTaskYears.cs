// NEW FILE: TimePlanner.API/Features/Queries/Tasks/GetTaskYears.cs
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.Services;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace TimePlanner.API.Features.Queries.Tasks;

// The query is simple and takes no parameters. It returns a list of integers.
public record GetTaskYearsQuery : IRequest<List<int>>;

public class GetTaskYearsQueryHandler : IRequestHandler<GetTaskYearsQuery, List<int>>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetTaskYearsQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<List<int>> Handle(GetTaskYearsQuery request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        // This is a very efficient database query.
        // It selects only the 'Start' column, extracts the Year part in the database,
        // gets the distinct years, and orders them descending.
        var years = await _context.Tasks
            .AsNoTracking()
            .Where(t => t.UserId == userId)
            .Select(t => t.Start.Year)
            .Distinct()
            .OrderByDescending(year => year)
            .ToListAsync(cancellationToken);

        // If the user has no tasks at all, ensure the current year is still an option.
        if (!years.Any())
        {
            years.Add(DateTime.UtcNow.Year);
        }

        return years;
    }
}