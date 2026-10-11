using System.Net;
using System.Text.Json;
using FluentValidation;
using TimePlanner.API.Exceptions;

namespace TimePlanner.API.Middleware;

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
            // If everything is fine, just continue to the next middleware/endpoint.
            await _next(context);
        }
        catch (Exception ex)
        {
            // If an exception occurs, handle it and create a response.
            await HandleExceptionAsync(context, ex);
        }
    }

    private async Task HandleExceptionAsync(HttpContext context, Exception exception)
    {
        context.Response.ContentType = "application/json";
        var response = context.Response;

        // Default to a 500 Internal Server Error
        var statusCode = (int)HttpStatusCode.InternalServerError;
        var message = "An unexpected error has occurred. Please try again later.";
        var errors = new List<string>();

        // We can check for specific exception types to return more appropriate
        // status codes and messages.
        switch (exception)
        {
            // This is the exception from our RegisterCommandHandler when a user exists.
            case ConflictException ex:
                statusCode = (int)HttpStatusCode.Conflict; // 409
                message = ex.Message;
                _logger.LogInformation("conflict Business rule: {Message}", ex.Message);

                break;

            // This handles FluentValidation exceptions.
            case ValidationException ex:
                statusCode = (int)HttpStatusCode.BadRequest; // 400
                message = "One or more validation errors occurred.";
                // The 'Errors' property in FluentValidation's exception contains the details.
                errors.AddRange(ex.Errors.Select(e => e.ErrorMessage));
                _logger.LogInformation("Validaton Business rule: {Message}", ex.Message);

                break;

            case KeyNotFoundException ex:
                statusCode = (int)HttpStatusCode.NotFound; // 404
                message = ex.Message;
                _logger.LogInformation("Not Found Business rule: {Message}", ex.Message);

                break;

            case UnauthorizedAccessException ex:
            statusCode = (int)HttpStatusCode.Unauthorized; // 401
            message = ex.Message;
            _logger.LogWarning("Unauthorized access attempt: {Message}", ex.Message);
            break;

            case BadRequestException ex:
            statusCode = (int)HttpStatusCode.BadRequest; // 400
            message = ex.Message;
            _logger.LogWarning("Bad Request: {Message}", ex.Message);
            break;

            // You can add more specific exception types here.
            // For example, an UnauthorizedAccessException for a 401/403.
            case ApplicationException ex when ex.Message.Contains("token"):
                statusCode = (int)HttpStatusCode.BadRequest; // 400
                message = ex.Message;
                _logger.LogInformation("Business rule conflict: {Message}", ex.Message);
                break;

            default:
                // 4. For truly unexpected errors, log the full exception details.
                // This automatically includes the stack trace when configured correctly.
                _logger.LogError(exception, "An unhandled exception occurred during the request.");

                // The message to the user remains generic for security.
                message = "An unexpected internal server error has occurred.";
                statusCode = (int)HttpStatusCode.InternalServerError;
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