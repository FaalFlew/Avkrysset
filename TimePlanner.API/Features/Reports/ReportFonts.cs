using System.Buffers.Binary;
using System.Collections;
using System.Globalization;
using QuestPDF.Drawing;
using QuestPDF.Infrastructure;

namespace TimePlanner.API.Features.Reports;

/// <summary>
/// The PDF engine's one-time setup: QuestPDF Community license, the embedded OFL Noto fonts
/// (Features/Reports/Fonts, see the OFL-*.txt files there) and glyph-coverage checks.
/// Text uses <see cref="Families"/> as a fallback list, so every character is drawn with the first font that has it:
/// Latin/Greek/Cyrillic, Arabic, Hebrew, CJK (Chinese, Japanese, Korean) and monochrome emoji.
/// Other scripts render as blanks instead of failing the export (<c>ThrowOnMissingTextGlyphs = false</c>);
/// <see cref="MissingCodePoints"/> lets the renderer log them.
/// Sources (unmodified): Noto Sans 2.015, Noto Sans Arabic UI 2.011 and Noto Sans Hebrew 3.001 (unhinted TTF) from
/// github.com/notofonts/notofonts.github.io; Noto Sans CJK SC 2.004 (OTF, covers Hangul and kana too, unlike the
/// 8 MB "Noto Sans SC" subset) from github.com/notofonts/noto-cjk; Noto Emoji 3.002 (variable) from
/// github.com/google/fonts (ofl/notoemoji). Arabic uses the "UI" variant of Noto Sans Arabic (same letterforms,
/// OFL-NotoSansArabic.txt): its line metrics match Noto Sans, so Arabic table rows are not taller or lower than
/// Latin ones, and it draws letters with their dots as one glyph, so copied/searched PDF text maps back to the
/// right characters (the non-UI font draws dots as separate glyphs that PDF text extraction can't map).
/// </summary>
public static class ReportFonts
{
    public const string Sans = "Noto Sans";

    /// <summary>Font fallback order for all report text.</summary>
    public static readonly string[] Families =
    {
        Sans, "Noto Sans Arabic UI", "Noto Sans Hebrew", "Noto Sans CJK SC", "Noto Emoji"
    };

    /// <summary>Embedded resource names (LogicalName "ReportFonts.{file}" in the csproj).</summary>
    public static readonly string[] Files =
    {
        "NotoSans-Regular.ttf",
        "NotoSans-Bold.ttf",
        "NotoSansArabicUI-Regular.ttf",
        "NotoSansHebrew-Regular.ttf",
        "NotoSansCJKsc-Regular.otf",
        "NotoEmoji-VariableFont_wght.ttf"
    };

    private static readonly object Gate = new();
    private static volatile BitArray? _coverage;

    public static bool IsInitialized => _coverage is not null;

    /// <summary>Configures QuestPDF and registers the fonts once per process (thread-safe, cheap after the first call).</summary>
    public static void EnsureInitialized()
    {
        if (_coverage is not null)
        {
            return;
        }

        lock (Gate)
        {
            if (_coverage is not null)
            {
                return;
            }

            // The owner confirmed Community license eligibility (plan §8 Q13).
            QuestPDF.Settings.License = LicenseType.Community;
            // A character no font has must not turn an export into a 500; it renders blank and is logged instead.
            QuestPDF.Settings.ThrowOnMissingTextGlyphs = false;
            // Only the embedded fonts: same output on every machine, and no recursive scan of the app directory.
            QuestPDF.Settings.UseSystemFonts = false;
            QuestPDF.Settings.FontDiscoveryPath = null;

            var coverage = new BitArray(0x110000);
            var assembly = typeof(ReportFonts).Assembly;
            foreach (var file in Files)
            {
                using var stream = assembly.GetManifestResourceStream("ReportFonts." + file)
                                   ?? throw new InvalidOperationException($"Embedded report font '{file}' is missing.");
                var data = new byte[stream.Length];
                stream.ReadExactly(data);

                AddCoverage(data, coverage);
                FontManager.RegisterFontFromBinaryData(data);
            }

            _coverage = coverage;
        }
    }

    /// <summary>Distinct code points in <paramref name="texts"/> that none of the report fonts can draw (at most <paramref name="max"/>).</summary>
    public static IReadOnlyList<int> MissingCodePoints(IEnumerable<string?> texts, int max = 20)
    {
        EnsureInitialized();
        var coverage = _coverage!;
        var missing = new SortedSet<int>();

        foreach (var text in texts)
        {
            if (string.IsNullOrEmpty(text))
            {
                continue;
            }

            foreach (var rune in text.EnumerateRunes())
            {
                var value = rune.Value;
                if (!IsInvisible(rune) && !coverage[value])
                {
                    missing.Add(value);
                    if (missing.Count >= max)
                    {
                        return missing.ToList();
                    }
                }
            }
        }

        return missing.ToList();
    }

    /// <summary>
    /// Width of a single line of <paramref name="text"/> in points, for layout decisions (no wrapping a duration, splitting an
    /// email address after its "@"): Noto Sans advance widths for printable ASCII (read from the embedded fonts' hmtx
    /// tables), 1 em for other characters (CJK, emoji) and 0.7 em for other letters, plus 3 % (no kerning is applied, which
    /// only ever makes real text narrower).
    /// </summary>
    public static float EstimateWidth(string text, float fontSize, bool bold = false)
    {
        var advances = bold ? BoldAsciiAdvances : RegularAsciiAdvances;
        var ems = 0f;
        foreach (var c in text)
        {
            ems += c switch
            {
                >= ' ' and <= '~' => advances[c - ' '],
                ' ' => advances[0],
                _ when char.IsLowSurrogate(c) => 0,
                _ when char.IsLetter(c) && c < 'ᄀ' => 0.7f,
                _ => 1f
            };
        }

        return ems * fontSize * 1.03f;
    }

    // Advance widths in em of U+0020 … U+007E (Noto Sans 2.015, unitsPerEm 1000).
    private static readonly float[] RegularAsciiAdvances =
    {
        0.260f, 0.269f, 0.408f, 0.646f, 0.572f, 0.831f, 0.732f, 0.225f, 0.300f, 0.300f, 0.551f, 0.572f, 0.268f, 0.322f, 0.268f, 0.372f,
        0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.268f, 0.268f, 0.572f, 0.572f, 0.572f, 0.434f,
        0.899f, 0.639f, 0.650f, 0.632f, 0.730f, 0.556f, 0.519f, 0.728f, 0.741f, 0.339f, 0.273f, 0.619f, 0.524f, 0.907f, 0.760f, 0.781f,
        0.605f, 0.781f, 0.622f, 0.549f, 0.556f, 0.731f, 0.600f, 0.930f, 0.586f, 0.566f, 0.572f, 0.329f, 0.372f, 0.329f, 0.572f, 0.444f,
        0.281f, 0.561f, 0.615f, 0.480f, 0.615f, 0.564f, 0.344f, 0.615f, 0.618f, 0.258f, 0.258f, 0.534f, 0.258f, 0.935f, 0.618f, 0.605f,
        0.615f, 0.615f, 0.413f, 0.479f, 0.361f, 0.618f, 0.508f, 0.786f, 0.529f, 0.510f, 0.470f, 0.380f, 0.551f, 0.380f, 0.572f
    };

    private static readonly float[] BoldAsciiAdvances =
    {
        0.260f, 0.282f, 0.479f, 0.646f, 0.572f, 0.902f, 0.750f, 0.266f, 0.339f, 0.339f, 0.542f, 0.572f, 0.285f, 0.320f, 0.281f, 0.415f,
        0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.572f, 0.281f, 0.285f, 0.572f, 0.572f, 0.572f, 0.477f,
        0.898f, 0.692f, 0.665f, 0.642f, 0.732f, 0.560f, 0.549f, 0.724f, 0.765f, 0.389f, 0.331f, 0.664f, 0.559f, 0.943f, 0.813f, 0.791f,
        0.621f, 0.791f, 0.656f, 0.551f, 0.577f, 0.756f, 0.650f, 0.967f, 0.670f, 0.626f, 0.579f, 0.331f, 0.415f, 0.331f, 0.572f, 0.411f,
        0.365f, 0.599f, 0.632f, 0.516f, 0.632f, 0.597f, 0.387f, 0.632f, 0.650f, 0.299f, 0.298f, 0.620f, 0.298f, 0.975f, 0.650f, 0.625f,
        0.632f, 0.632f, 0.447f, 0.502f, 0.434f, 0.650f, 0.571f, 0.856f, 0.578f, 0.571f, 0.493f, 0.394f, 0.551f, 0.394f, 0.572f
    };

    public static string Describe(IEnumerable<int> codePoints) =>
        string.Join(", ", codePoints.Select(c => "U+" + c.ToString("X4", CultureInfo.InvariantCulture)));

    // Formatting characters that are not drawn as glyphs (joiners, direction marks, variation selectors, tags).
    private static bool IsInvisible(System.Text.Rune rune)
    {
        var value = rune.Value;
        return System.Text.Rune.IsControl(rune)
               || System.Text.Rune.IsWhiteSpace(rune)
               || value is >= 0x200B and <= 0x200F
               || value is >= 0x202A and <= 0x202E
               || value is >= 0x2060 and <= 0x206F
               || value is >= 0xFE00 and <= 0xFE0F
               || value == 0xFEFF
               || value is >= 0xE0000 and <= 0xE007F
               || value is >= 0xE0100 and <= 0xE01EF;
    }

    /// <summary>Marks the code points mapped by the font's best Unicode cmap subtable (format 12 or 4).</summary>
    internal static void AddCoverage(byte[] font, BitArray coverage)
    {
        ushort U16(int offset) => BinaryPrimitives.ReadUInt16BigEndian(font.AsSpan(offset));
        uint U32(int offset) => BinaryPrimitives.ReadUInt32BigEndian(font.AsSpan(offset));

        var cmap = -1;
        int tableCount = U16(4);
        for (var i = 0; i < tableCount; i++)
        {
            var record = 12 + 16 * i;
            if (font.AsSpan(record, 4).SequenceEqual("cmap"u8))
            {
                cmap = (int)U32(record + 8);
                break;
            }
        }

        if (cmap < 0)
        {
            throw new InvalidOperationException("Font has no cmap table.");
        }

        int best = -1, bestScore = 0;
        int subtableCount = U16(cmap + 2);
        for (var i = 0; i < subtableCount; i++)
        {
            var record = cmap + 4 + 8 * i;
            int platform = U16(record), encoding = U16(record + 2);
            var offset = cmap + (int)U32(record + 4);
            int format = U16(offset);
            var unicode = platform == 0 || (platform == 3 && encoding is 1 or 10);
            var score = !unicode ? 0 : format == 12 ? 2 : format == 4 ? 1 : 0;
            if (score > bestScore)
            {
                best = offset;
                bestScore = score;
            }
        }

        if (best < 0)
        {
            throw new InvalidOperationException("Font has no Unicode cmap subtable.");
        }

        if (bestScore == 2)
        {
            var groups = (int)U32(best + 12);
            for (var g = 0; g < groups; g++)
            {
                var group = best + 16 + 12 * g;
                var start = (int)U32(group);
                var end = (int)Math.Min(U32(group + 4), 0x10FFFF);
                var startGlyph = U32(group + 8);
                for (var c = start; c <= end; c++)
                {
                    if (startGlyph + (uint)(c - start) != 0)
                    {
                        coverage[c] = true;
                    }
                }
            }

            return;
        }

        int segCountX2 = U16(best + 6);
        var ends = best + 14;
        var starts = ends + segCountX2 + 2;
        var deltas = starts + segCountX2;
        var rangeOffsets = deltas + segCountX2;
        for (var s = 0; s < segCountX2 / 2; s++)
        {
            int end = U16(ends + 2 * s), start = U16(starts + 2 * s);
            var delta = (short)U16(deltas + 2 * s);
            var rangeOffsetPosition = rangeOffsets + 2 * s;
            int rangeOffset = U16(rangeOffsetPosition);
            for (var c = start; c <= end && c != 0xFFFF; c++)
            {
                int glyph;
                if (rangeOffset == 0)
                {
                    glyph = (c + delta) & 0xFFFF;
                }
                else
                {
                    glyph = U16(rangeOffsetPosition + rangeOffset + 2 * (c - start));
                    if (glyph != 0)
                    {
                        glyph = (glyph + delta) & 0xFFFF;
                    }
                }

                if (glyph != 0)
                {
                    coverage[c] = true;
                }
            }
        }
    }
}
