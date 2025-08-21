using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Api.DTOs;
using Api.Features.Commands.Tasks;
using Api.Features.Queries.Tasks;

namespace Api.Controllers;

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

    [HttpGet]
    [ProducesResponseType(typeof(List<TaskItemDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetUserTasks(DateTime startDate, DateTime endDate)
    {
        var result = await _mediator.Send(new GetTasksByDateRangeQuery(startDate, endDate));
        return Ok(result);
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