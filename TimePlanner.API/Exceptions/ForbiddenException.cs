namespace TimePlanner.API.Exceptions;

/// <summary>
/// The caller is signed in but not allowed to do this (HTTP 403).
/// Use <see cref="UnauthorizedAccessException"/> (401) only when nobody is signed in.
/// </summary>
public class ForbiddenException : Exception
{
    public ForbiddenException(string message) : base(message)
    {
    }
}
