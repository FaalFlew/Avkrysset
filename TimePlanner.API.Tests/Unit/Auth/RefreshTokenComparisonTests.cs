using System.Security.Cryptography;
using TimePlanner.API.Utilities;

namespace TimePlanner.API.Tests.Unit.Auth;

/// <summary>The exact, constant-time refresh-token match used by logout.</summary>
public sealed class RefreshTokenComparisonTests
{
    // Shaped like an issued token: 64 random bytes, Base64 (88 characters).
    private static readonly string Token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

    private static string WithCharAt(string value, int index) =>
        value[..index] + (value[index] == 'A' ? 'B' : 'A') + value[(index + 1)..];

    [Fact]
    public void Equal_tokens_match_even_as_different_string_instances()
    {
        Assert.Equal(88, Token.Length);
        Assert.True(RefreshTokenComparison.FixedTimeEquals(Token, new string(Token.ToCharArray())));
    }

    [Fact]
    public void Any_difference_is_a_mismatch()
    {
        var otherCase = new string(Token.Select(c => char.IsUpper(c) ? char.ToLowerInvariant(c) : char.ToUpperInvariant(c)).ToArray());

        foreach (var presented in new[]
                 {
                     WithCharAt(Token, 0), WithCharAt(Token, Token.Length / 2), WithCharAt(Token, Token.Length - 1),
                     otherCase, Token[..^1], Token + "A", " " + Token, "", Convert.ToBase64String(RandomNumberGenerator.GetBytes(64))
                 })
        {
            Assert.False(RefreshTokenComparison.FixedTimeEquals(presented, Token), presented);
            Assert.False(RefreshTokenComparison.FixedTimeEquals(Token, presented), presented);
        }
    }

    [Fact]
    public void Null_never_matches()
    {
        Assert.False(RefreshTokenComparison.FixedTimeEquals(null, Token));
        Assert.False(RefreshTokenComparison.FixedTimeEquals(Token, null));
        Assert.False(RefreshTokenComparison.FixedTimeEquals(null, null));
    }

    [Fact]
    public void Non_ascii_is_compared_by_its_utf8_bytes()
    {
        const char oSlash = (char)0x00F8, eAcute = (char)0x00E9, combiningAcute = (char)0x0301;
        var token = $"t{oSlash}ken-{eAcute}";

        Assert.True(RefreshTokenComparison.FixedTimeEquals(token, new string(token.ToCharArray())));
        Assert.False(RefreshTokenComparison.FixedTimeEquals(token, "token-e"));
        // A precomposed e-acute vs. "e" + a combining acute: equal to the eye, different bytes.
        Assert.False(RefreshTokenComparison.FixedTimeEquals(eAcute.ToString(), $"e{combiningAcute}"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public void Missing_or_blank_tokens_are_ignored(string? token)
    {
        Assert.Null(RefreshTokenComparison.Normalize(token));
    }

    [Fact]
    public void Oversized_tokens_are_ignored_and_others_are_kept_as_they_are()
    {
        Assert.Equal(Token, RefreshTokenComparison.Normalize(Token));
        Assert.Equal(" " + Token, RefreshTokenComparison.Normalize(" " + Token)); // never trimmed: the match is exact
        var longest = new string('A', RefreshTokenComparison.MaxLength);
        Assert.Equal(longest, RefreshTokenComparison.Normalize(longest));
        Assert.Null(RefreshTokenComparison.Normalize(longest + "A"));
    }
}
