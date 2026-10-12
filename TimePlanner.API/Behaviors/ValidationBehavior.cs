using FluentValidation;
using MediatR;
using TimePlanner.API.Exceptions;

namespace TimePlanner.API.Behaviors;

/// <summary>
/// Runs every FluentValidation validator registered for the request before its handler.
/// Failures become a <see cref="BadRequestException"/>, so the client gets a 400 with
/// { message, errors }: "message" is readable on its own (the frontend shows it in a toast),
/// "errors" lists each failed rule.
/// </summary>
public sealed class ValidationBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private readonly IEnumerable<IValidator<TRequest>> _validators;

    public ValidationBehavior(IEnumerable<IValidator<TRequest>> validators)
    {
        _validators = validators;
    }

    public async Task<TResponse> Handle(
        TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken cancellationToken)
    {
        var failures = new List<string>();
        foreach (var validator in _validators)
        {
            var result = await validator.ValidateAsync(new ValidationContext<TRequest>(request), cancellationToken);
            failures.AddRange(result.Errors.Select(e => e.ErrorMessage));
        }

        if (failures.Count > 0)
        {
            var distinct = failures.Distinct().ToList();
            throw new BadRequestException(string.Join(" ", distinct), distinct);
        }

        return await next(cancellationToken);
    }
}
