using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TimePlanner.API.DTOs;
using TimePlanner.API.Features.Commands.Tasks;
using TimePlanner.API.Features.Queries.Tasks;

namespace TimePlanner.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class TasksController : ControllerBase
{
    private readonly ISender _mediator;

    public TasksController(ISender mediator)
    {
        _mediator = mediator;
    }

    // Example of getting tasks for a week. 
    // The frontend will determine the date range it needs.
    [HttpGet]
    [ProducesResponseType(typeof(List<TaskItemDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetUserTasks(DateTime startDate, DateTime endDate)
    {
        var result = await _mediator.Send(new GetTasksByDateRangeQuery(startDate, endDate));
        return Ok(result);
    }

    [HttpGet("years")]
    [ProducesResponseType(typeof(List<int>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTaskYears()
    {
        var result = await _mediator.Send(new GetTaskYearsQuery());
        return Ok(result);
    }

    [HttpPost("from-template")] // A specific, descriptive route
    [ProducesResponseType(typeof(TaskItemDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> CreateTaskFromTemplate(CreateTaskFromTemplateRequest request)
    {
        var command = new CreateTaskFromTemplateCommand(request.TemplateId, request.Start);
        var result = await _mediator.Send(command);

        // We can reuse the GetUserTasks action name for the Location header, though a GetById would be more precise.
        return CreatedAtAction(nameof(GetUserTasks), new { id = result.Id }, result);
    }

    [HttpPost]
    [ProducesResponseType(typeof(TaskItemDto), StatusCodes.Status201Created)]
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

    [HttpGet("analytics")]
    [ProducesResponseType(typeof(TaskAnalyticsDto), StatusCodes.Status200OK)] // MODIFIED type hint
    public async Task<IActionResult> GetTaskAnalytics(
        [FromQuery] DateTime startDate,
        [FromQuery] DateTime endDate,
        [FromQuery] string viewType) // ADDED viewType parameter
    {
        // MODIFIED: Pass the new parameter to the query
        var result = await _mediator.Send(new GetTaskAnalyticsQuery(startDate, endDate, viewType));
        return Ok(result);
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
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
}