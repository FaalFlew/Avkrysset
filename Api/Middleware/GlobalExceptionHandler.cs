using System.Net;
using System.Text.Json;
using Api.Exceptions;
using FluentValidation;

namespace Api.Middleware;

public class GlobalExceptionHandler
{
    private readonly RequestDelegate _next;
    private readonly ILogger<GlobalExceptionHandler> _logger;

    public GlobalExceptionHandler(RequestDelegate next, ILogger<GlobalExceptionHandler> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            await HandleExceptionAsync(context, ex);
        }
    }

    private async Task HandleExceptionAsync(HttpContext context, Exception exception)
    {
        context.Response.ContentType = "application/json";
        var response = context.Response;

        var statusCode = (int)HttpStatusCode.InternalServerError;
        var message = "An unexpected error has occurred. Please try again later.";
        var errors = new List<string>();

        switch (exception)
        {

            case ValidationException ex:
                statusCode = (int)HttpStatusCode.BadRequest;
                message = "One or more validation errors occurred.";
                errors.AddRange(ex.Errors.Select(e => e.ErrorMessage));
                break;

            case ApplicationException ex when ex.Message.Contains("token"):
                statusCode = (int)HttpStatusCode.BadRequest;
                message = ex.Message;
                break;
            case ConflictException ex:
                statusCode = (int)HttpStatusCode.Conflict; // 409
                message = ex.Message;
                break;

            case KeyNotFoundException ex:
                statusCode = (int)HttpStatusCode.NotFound;
                message = ex.Message;
                break;

            default:
                _logger.LogError(exception, "An unhandled exception has occurred: {Message}", exception.Message);
                break;
        }

        context.Response.StatusCode = statusCode;

        var errorResponse = new
        {
            message,
            errors
        };

        await context.Response.WriteAsync(JsonSerializer.Serialize(errorResponse));
    }
}