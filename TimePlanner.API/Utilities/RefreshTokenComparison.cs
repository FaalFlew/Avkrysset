using System.Security.Cryptography;
using System.Text;

namespace TimePlanner.API.Utilities;

/// <summary>
/// Matching a presented refresh token against a stored one. A database lookup by token compares strings with an early
/// exit and, under SQL Server's default collation, case-insensitively, so a user found that way is only acted on after
/// this exact (ordinal) comparison, whose running time does not depend on where the two tokens differ.
/// </summary>
public static class RefreshTokenComparison
{
    /// <summary>Issued refresh tokens are 88 characters (64 random bytes, Base64); longer input is never one of ours.</summary>
    public const int MaxLength = 512;

    /// <summary>The token when it could be one we issued; null when it is missing, blank or oversized.</summary>
    public static string? Normalize(string? token) =>
        string.IsNullOrWhiteSpace(token) || token.Length > MaxLength ? null : token;

    /// <summary>
    /// Exact, case-sensitive equality in constant time (CryptographicOperations.FixedTimeEquals on the UTF-8 bytes).
    /// Inputs of different byte lengths return false at once: the length of a refresh token is not a secret.
    /// </summary>
    public static bool FixedTimeEquals(string? presented, string? stored)
    {
        if (presented is null || stored is null)
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(presented), Encoding.UTF8.GetBytes(stored));
    }
}
