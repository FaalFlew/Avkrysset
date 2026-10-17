namespace TimePlanner.API.Exceptions;

public class BadRequestException : Exception
{
    public BadRequestException(string message) : base(message)
    {
    }

    // Individual problems (e.g. one per failed validation rule), returned as "errors" next to "message".
    public BadRequestException(string message, IEnumerable<string> errors) : base(message)
    {
        Errors = errors.ToList();
    }

    public IReadOnlyList<string> Errors { get; } = Array.Empty<string>();
}
