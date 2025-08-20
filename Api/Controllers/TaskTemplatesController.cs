using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Api.DTOs;
using Api.Features.Commands.TaskTemplates;
using Api.Features.Queries.TaskTemplates;

namespace Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class TaskTemplatesController : ControllerBase
{
    private readonly ISender _mediator;

    public TaskTemplatesController(ISender mediator)
    {
        _mediator = mediator;
    }

    [HttpGet]
    [ProducesResponseType(typeof(List<TaskTemplateDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetUserTaskTemplates()
    {
        var result = await _mediator.Send(new GetUserTaskTemplatesQuery());
        return Ok(result);
    }

    [HttpPost]
    [ProducesResponseType(typeof(TaskTemplateDto), StatusCodes.Status201Created)]
    public async Task<IActionResult> CreateTaskTemplate(CreateTaskTemplateRequest request)
    {
        var command = new CreateTaskTemplateCommand(request.Title, request.Duration, request.CategoryId);
        var result = await _mediator.Send(command);
        return CreatedAtAction(nameof(GetUserTaskTemplates), new { id = result.Id }, result);
    }

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> UpdateTaskTemplate(Guid id, UpdateTaskTemplateRequest request)
    {
        var command = new UpdateTaskTemplateCommand(id, request.Title, request.Duration, request.CategoryId);
        await _mediator.Send(command);
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> DeleteTaskTemplate(Guid id)
    {
        await _mediator.Send(new DeleteTaskTemplateCommand(id));
        return NoContent();
    }
}