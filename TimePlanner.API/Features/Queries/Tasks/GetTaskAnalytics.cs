// MODIFIED FILE: TimePlanner.API/Features/Queries/Tasks/GetTaskAnalytics.cs
using System;
using System.Collections.Generic; // ADDED
using System.Globalization; // ADDED
using System.Linq; // ADDED
using MediatR;
using Microsoft.EntityFrameworkCore;
using TimePlanner.API.Data;
using TimePlanner.API.DTOs;
using TimePlanner.API.Services;

namespace TimePlanner.API.Features.Queries.Tasks;

// MODIFICATION: The query now accepts a ViewType to determine how to group the data.
public record GetTaskAnalyticsQuery(DateTime StartDate, DateTime EndDate, string ViewType)
    : IRequest<TaskAnalyticsDto>;

public class GetTaskAnalyticsQueryHandler
    : IRequestHandler<GetTaskAnalyticsQuery, TaskAnalyticsDto>
{
    private readonly ApplicationDbContext _context;
    private readonly ICurrentUserService _currentUserService;

    public GetTaskAnalyticsQueryHandler(ApplicationDbContext context, ICurrentUserService currentUserService)
    {
        _context = context;
        _currentUserService = currentUserService;
    }

    public async Task<TaskAnalyticsDto> Handle(GetTaskAnalyticsQuery request, CancellationToken cancellationToken)
    {
        var userId = _currentUserService.UserId;
        if (userId == null) throw new UnauthorizedAccessException();

        var tasks = await _context.Tasks
            .AsNoTracking()
            .Where(t => t.UserId == userId && t.Start >= request.StartDate && t.Start < request.EndDate)
            .Include(t => t.Category)
            .Select(t => new { t.Start, t.Duration, t.CategoryId, t.Category.Color, t.TemplateId, t.User.TaskTemplates })
            .ToListAsync(cancellationToken);

        // --- Existing calculations remain valid ---
        var totalHours = tasks.Sum(t => t.Duration);

        var timePerCategory = tasks
            .GroupBy(t => t.CategoryId)
            .Select(g =>
            {
                var first = g.First();
                var category = _context.Categories.Find(g.Key);
                return new TimePerCategoryDto
                {
                    CategoryId = g.Key,
                    CategoryName = category?.Name ?? "Unknown",
                    CategoryColor = category?.Color ?? "#ccc",
                    TotalHours = g.Sum(x => x.Duration)
                };
            }).ToList();

        var timePerTemplate = tasks
            .Where(t => t.TemplateId.HasValue)
            .GroupBy(t => t.TemplateId)
            .Select(g =>
            {
                var template = _context.TaskTemplates.Include(tt => tt.Category).FirstOrDefault(tt => tt.Id == g.Key);
                return new TimePerTemplateDto
                {
                    TemplateId = g.Key,
                    TemplateTitle = template?.Title,
                    CategoryColor = template?.Category.Color,
                    TotalHours = g.Sum(x => x.Duration)
                };
            }).ToList();

        // --- ADDED: Logic to generate breakdown data based on ViewType ---
        var breakdownData = new List<BreakdownDataPointDto>();
        switch (request.ViewType?.ToLower())
        {
            case "monthly":
                breakdownData = tasks
                    .GroupBy(t => t.Start.Month)
                    .Select(g => new BreakdownDataPointDto
                    {
                        Label = CultureInfo.CurrentCulture.DateTimeFormat.GetMonthName(g.Key),
                        Value = g.Sum(t => t.Duration),
                        DominantCategoryColor = GetDominantColor(g)
                    })
                    .OrderBy(d => DateTime.ParseExact(d.Label, "MMMM", CultureInfo.CurrentCulture).Month)
                    .ToList();
                break;
            case "weekly":
                breakdownData = tasks
                    .GroupBy(t => ISOWeek.GetWeekOfYear(t.Start))
                    .Select(g => new BreakdownDataPointDto
                    {
                        Label = $"Week {g.Key}",
                        Value = g.Sum(t => t.Duration),
                        DominantCategoryColor = GetDominantColor(g)
                    })
                    .OrderBy(d => int.Parse(d.Label.Replace("Week ", "")))
                    .ToList();
                break;

            case "daily":
                breakdownData = tasks
                    .GroupBy(t => t.Start.DayOfWeek) // Group by the day of the week
                    .Select(g => new BreakdownDataPointDto
                    {
                        // Use the full day name for the label (e.g., "Monday")
                        Label = g.Key.ToString(),
                        Value = g.Sum(t => t.Duration),
                        DominantCategoryColor = GetDominantColor(g)
                    })
                    // Order the results correctly from Sunday to Saturday or Monday to Sunday
                    .OrderBy(d => (int)Enum.Parse<DayOfWeek>(d.Label))
                    .ToList();
                break;
        }

        return new TaskAnalyticsDto
        {
            TotalHours = totalHours,
            TimePerCategory = timePerCategory,
            TimePerTemplate = timePerTemplate,
            BreakdownData = breakdownData // ADDED
        };
    }

    // ADDED: Helper method to find the most frequent category color in a group of tasks
    private string GetDominantColor(IEnumerable<dynamic> tasks)
    {
        if (!tasks.Any()) return "#A0AEC0";

        var dominantCategory = tasks
            .GroupBy(t => t.CategoryId)
            .Select(g => new { CategoryId = g.Key, TotalDuration = g.Sum(t => (double)t.Duration) })
            .OrderByDescending(x => x.TotalDuration)
            .FirstOrDefault();

        if (dominantCategory == null) return "#A0AEC0";

        // Find the color from the first task with that category ID
        return tasks.First(t => t.CategoryId == dominantCategory.CategoryId).Color;
    }
}