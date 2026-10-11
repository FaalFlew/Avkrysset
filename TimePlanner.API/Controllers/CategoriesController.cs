using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using TimePlanner.API.DTOs;
using TimePlanner.API.Features.Commands.Categories;
using TimePlanner.API.Features.Queries.Categories;

namespace TimePlanner.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize] // IMPORTANT: This attribute protects all endpoints in this controller.
public class CategoriesController : ControllerBase
{
    private readonly ISender _mediator;

    public CategoriesController(ISender mediator)
    {
        _mediator = mediator;
    }

    [HttpGet]
    [ProducesResponseType(typeof(List<CategoryDto>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetUserCategories()
    {
        var result = await _mediator.Send(new GetUserCategoriesQuery());
        return Ok(result);
    }

    [HttpPost]
    [ProducesResponseType(typeof(CategoryDto), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> CreateCategory(CreateCategoryCommand command)
    {
        var result = await _mediator.Send(command);
        // Returns a 201 Created status with a Location header pointing to the new resource.
        return CreatedAtAction(nameof(GetUserCategories), new { id = result.Id }, result);
    }

    // Inside CategoriesController.cs

    [HttpPut("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateCategory(Guid id, [FromBody] UpdateCategoryRequest request)
    {
        var command = new UpdateCategoryCommand(id, request.Name, request.Color);
        await _mediator.Send(command);
        return NoContent();
    }

    // Inside CategoriesController.cs

    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteCategory(Guid id)
    {
        await _mediator.Send(new DeleteCategoryCommand(id));
        return NoContent();
    }
}