namespace TimePlanner.API.Exceptions;

/// <summary>
/// Represents an exception that occurs when an action cannot be completed
/// because it conflicts with existing data (e.g., creating a duplicate resource).
/// This exception should typically result in an HTTP 409 Conflict status code.
/// </summary>
public class ConflictException : Exception
{
    public ConflictException(string message) : base(message)
    {
    }
}