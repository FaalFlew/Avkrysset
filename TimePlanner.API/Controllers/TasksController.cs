using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TimePlanner.API.DTOs;
using TimePlanner.API.Exceptions;
using TimePlanner.API.Features.Commands.Tasks;
using TimePlanner.API.Features.Queries.Tasks;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class TasksController : ControllerBase
{
    // Generous upper bound: the largest client range is a year of months or 53 ISO weeks.
    private static readonly TimeSpan MaxRange = TimeSpan.FromDays(400);

    private readonly ISender _mediator;

    public TasksController(ISender mediator)
    {
        _mediator = mediator;
    }

    // Tasks whose start lies in the half-open range [startDate, endDate) of UTC instants.
    // The frontend determines the range it needs (e.g. a week or a day in the user's time zone).
    [HttpGet]
    [ProducesResponseType(typeof(List<TaskItemDto>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetUserTasks([FromQuery] DateTime? startDate, [FromQuery] DateTime? endDate)
    {
        var (start, end) = ValidateRange(startDate, endDate);
        var result = await _mediator.Send(new GetTasksByDateRangeQuery(start, end));
        return Ok(result);
    }

    [HttpGet("years")]
    [ProducesResponseType(typeof(List<int>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTaskYears()
    {
        var result = await _mediator.Send(new GetTaskYearsQuery(ClientTimeZone.GetId(Request)));
        return Ok(result);
    }

    [HttpPost("from-template")] // A specific, descriptive route
    [ProducesResponseType(typeof(TaskItemDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> CreateTaskFromTemplate(CreateTaskFromTemplateRequest request)
    {
        var command = new CreateTaskFromTemplateCommand(request.TemplateId, request.Start);
        var result = await _mediator.Send(command);

        // We can reuse the GetUserTasks action name for the Location header, though a GetById would be more precise.
        return CreatedAtAction(nameof(GetUserTasks), new { id = result.Id }, result);
    }

    [HttpPost]
    [ProducesResponseType(typeof(TaskItemDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> CreateTask(CreateTaskItemRequest request)
    {
        var command = new CreateTaskCommand(
            request.Title,
            request.Start,
            request.Duration,
            request.CategoryId,
            request.TemplateId
        );
        var result = await _mediator.Send(command);
        return CreatedAtAction(nameof(GetUserTasks), new { id = result.Id }, result);
    }

    // Breakdown buckets are calendar months/ISO weeks/days in the zone sent in the X-Time-Zone header (UTC if absent).
    [HttpGet("analytics")]
    [ProducesResponseType(typeof(TaskAnalyticsDto), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetTaskAnalytics(
        [FromQuery] DateTime? startDate,
        [FromQuery] DateTime? endDate,
        [FromQuery] string? viewType)
    {
        var (start, end) = ValidateRange(startDate, endDate);
        if (!TaskAnalyticsBreakdown.IsSupportedViewType(viewType))
        {
            throw new BadRequestException("viewType must be 'monthly', 'weekly' or 'daily'.");
        }

        var result = await _mediator.Send(
            new GetTaskAnalyticsQuery(start, end, viewType, ClientTimeZone.GetId(Request)));
        return Ok(result);
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<IActionResult> UpdateTask(Guid id, UpdateTaskItemRequest request)
    {
        var command = new UpdateTaskCommand(
            id,
            request.Title,
            request.Start,
            request.Duration,
            request.CategoryId,
            request.TemplateId
        );
        await _mediator.Send(command);
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DeleteTask(Guid id)
    {
        await _mediator.Send(new DeleteTaskCommand(id));
        return NoContent();
    }

    // Errors go through GlobalExceptionHandler so the body is { message, errors } like every other API error.
    private static (DateTime Start, DateTime End) ValidateRange(DateTime? startDate, DateTime? endDate)
    {
        if (startDate is null || endDate is null)
        {
            throw new BadRequestException("Both startDate and endDate are required.");
        }

        if (startDate.Value >= endDate.Value)
        {
            throw new BadRequestException("The start date must be before the end date.");
        }

        if (endDate.Value - startDate.Value > MaxRange)
        {
            throw new BadRequestException($"The date range cannot exceed {MaxRange.TotalDays} days.");
        }

        return (startDate.Value, endDate.Value);
    }
}
