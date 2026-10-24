namespace TimePlanner.API.Utilities;

/// <summary>
/// Colors for organizations in personal analytics, where an assignee's organization tasks are
/// grouped under the organization's name instead of the creator's personal category.
/// The palette is the planner's category palette without Slate (#7D8590, used for "Other"):
/// Blue, Orange, Teal, Purple, Amber, Pink, Green, Indigo, Red, Sky, Olive.
/// An organization always gets the same color: FNV-1a hash of its id's bytes, modulo the palette size.
/// </summary>
public static class OrganizationPalette
{
    public static readonly IReadOnlyList<string> Colors = new[]
    {
        "#2F7FE0", "#DA6A1C", "#0E9C8C", "#8E55CC", "#B87D10", "#D3449E",
        "#3D9A50", "#5E6AD2", "#E0484E", "#0A95B8", "#7A9620"
    };

    public static string ColorFor(Guid organizationId)
    {
        const uint offsetBasis = 2166136261;
        const uint prime = 16777619;

        var hash = offsetBasis;
        foreach (var b in organizationId.ToByteArray())
        {
            hash ^= b;
            hash *= prime;
        }

        return Colors[(int)(hash % (uint)Colors.Count)];
    }
}
