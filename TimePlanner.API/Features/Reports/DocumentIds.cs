using System.Globalization;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace TimePlanner.API.Features.Reports;

/// <summary>
/// Document IDs printed on every export and stored in ReportExports: "TP-yyyyMMdd-XXXXXXXX" — the UTC date
/// of generation and 8 random Crockford base32 characters (40 bits from a cryptographic RNG; no I, L, O, U).
/// </summary>
public static partial class DocumentIds
{
    public const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    public const int RandomLength = 8;

    public static string New(DateTime generatedAtUtc)
    {
        Span<byte> bytes = stackalloc byte[5]; // 40 bits = 8 base32 characters
        RandomNumberGenerator.Fill(bytes);

        ulong bits = 0;
        foreach (var b in bytes)
        {
            bits = (bits << 8) | b;
        }

        Span<char> random = stackalloc char[RandomLength];
        for (var i = RandomLength - 1; i >= 0; i--)
        {
            random[i] = Alphabet[(int)(bits & 31)];
            bits >>= 5;
        }

        var date = DateTime.SpecifyKind(generatedAtUtc, DateTimeKind.Utc).ToString("yyyyMMdd", CultureInfo.InvariantCulture);
        return $"TP-{date}-{new string(random)}";
    }

    public static bool IsValid(string? documentId) => documentId is not null && Pattern().IsMatch(documentId);

    [GeneratedRegex("^TP-[0-9]{8}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
