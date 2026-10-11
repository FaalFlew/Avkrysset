// src/lib/categoryPalette.ts — validated category color presets (UI_PLAN §2 Category palette).
// Same hex in both themes; every preset is ≥ 3.16:1 against every light and dark surface.

export interface CategoryPreset {
  /** Human name shown in the color picker ("Blue"). */
  name: string;
  /** "#RRGGBB" as stored on the category. */
  hex: string;
  /** Matching CSS custom property in tokens.css. */
  token: string;
}

/** Presets in default assignment order. The last one (Slate) is the neutral used for "Other". */
export const CATEGORY_PRESETS: readonly CategoryPreset[] = [
  { name: "Blue", hex: "#2F7FE0", token: "--cat-blue" },
  { name: "Orange", hex: "#DA6A1C", token: "--cat-orange" },
  { name: "Teal", hex: "#0E9C8C", token: "--cat-teal" },
  { name: "Purple", hex: "#8E55CC", token: "--cat-purple" },
  { name: "Amber", hex: "#B87D10", token: "--cat-amber" },
  { name: "Pink", hex: "#D3449E", token: "--cat-pink" },
  { name: "Green", hex: "#3D9A50", token: "--cat-green" },
  { name: "Indigo", hex: "#5E6AD2", token: "--cat-indigo" },
  { name: "Red", hex: "#E0484E", token: "--cat-red" },
  { name: "Sky", hex: "#0A95B8", token: "--cat-sky" },
  { name: "Olive", hex: "#7A9620", token: "--cat-olive" },
  { name: "Slate", hex: "#7D8590", token: "--cat-slate" },
] as const;

/** The 11 chromatic presets (everything except the neutral Slate). */
export const CHROMATIC_PRESETS: readonly CategoryPreset[] = CATEGORY_PRESETS.slice(0, -1);

/** Neutral color for the default "Other" category (Slate). */
export const OTHER_COLOR = "#7D8590";

/** Color the backend seeds for "Other" on existing accounts; still renders fine. */
export const LEGACY_OTHER_COLOR = "#8B949E";

/** Preset name for a hex ("#2f7fe0" → "Blue"), or null for custom colors. */
export function presetName(hex: string): string | null {
  const upper = hex.toUpperCase();
  return CATEGORY_PRESETS.find((p) => p.hex === upper)?.name ?? null;
}

/**
 * Default color for a new category: the first chromatic preset not already used
 * (case-insensitive). When all 11 are taken, cycles through them by usage count.
 */
export function nextPresetColor(usedHexes: Iterable<string>): string {
  const used = new Set<string>();
  for (const hex of usedHexes) used.add(hex.toUpperCase());
  const free = CHROMATIC_PRESETS.find((p) => !used.has(p.hex));
  if (free) return free.hex;
  return CHROMATIC_PRESETS[used.size % CHROMATIC_PRESETS.length]!.hex;
}
