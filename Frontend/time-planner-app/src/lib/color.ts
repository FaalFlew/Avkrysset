// src/lib/color.ts — color math for category colors (WCAG luminance/contrast, block tints).

export type ThemeName = "light" | "dark";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** True for "#RRGGBB" (the format the backend requires for category colors). */
export function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX6.test(value);
}

/**
 * Normalises user input to "#RRGGBB" (upper case). Accepts "#abc", "abc", "#aabbcc", "aabbcc".
 * Returns null when the input is not a hex color.
 */
export function normalizeHex(value: string): string | null {
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .split("")
      .map((c) => c + c)
      .join("")}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw}`.toUpperCase();
  return null;
}

/** "#RRGGBB" (or "#RGB") → [r, g, b] in 0–255, or null when invalid. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return [1, 3, 5].map((i) => parseInt(normalized.slice(i, i + 2), 16)) as [number, number, number];
}

function channelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance (0 = black, 1 = white). Invalid input returns 0. */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(channelToLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB mix like CSS `color-mix(in srgb, a <weight*100>%, b)`; returns "#RRGGBB". */
export function mixHex(a: string, b: string, weightA: number): string {
  const ca = hexToRgb(a) ?? [0, 0, 0];
  const cb = hexToRgb(b) ?? [0, 0, 0];
  const w = Math.min(1, Math.max(0, weightA));
  return `#${ca
    .map((c, i) => Math.round(c * w + cb[i]! * (1 - w))
      .toString(16)
      .padStart(2, "0"))
    .join("")}`.toUpperCase();
}

// ------------------------------------------------------------------ task block colors
//
// A task block is drawn as: background `color-mix(in srgb, <cat> <tint>, var(--grid-bg))`,
// a 3px marker / resize handles in <cat>, title in --block-text and time/meta in --block-meta
// (UI_PLAN §2). The helpers below make that work for ANY user color:
//   • blockEdgeColor(): the color to use as <cat>. Unchanged when it already has ≥ 3:1 against
//     --grid-bg (all presets do); otherwise the same hue is lightened (dark theme) or darkened
//     (light theme) just enough to reach 3:1, so marker, handles and fill stay perceivable
//     (e.g. #1A1A2E in dark mode, pale #FFFDE7 in light mode).
//   • blockTint()/blockTintHover(): the largest standard tint (light 14/20 %, dark 22/30 %, or
//     14/20 % for very light colors in dark mode) that keeps title AND meta text ≥ 4.5:1;
//     computed on the edge color, so it is also safe when the raw color is used as <cat>.
// Theme values mirror tokens.css (--grid-bg, --text-primary, --text-secondary).

interface BlockThemeSpec {
  gridBg: string;
  text: string;
  meta: string;
  tint: number;
  tintHover: number;
  /** Tints for very light colors (dark theme only). */
  paleTint: number;
  paleTintHover: number;
  /** Mixed into a low-contrast color to raise its contrast against gridBg. */
  contrastTarget: string;
}

const BLOCK_THEMES: Record<ThemeName, BlockThemeSpec> = {
  light: {
    gridBg: "#FFFFFF",
    text: "#18181B",
    meta: "#52525B",
    tint: 14,
    tintHover: 20,
    paleTint: 14,
    paleTintHover: 20,
    contrastTarget: "#000000",
  },
  dark: {
    gridBg: "#141416",
    text: "#EDEDEF",
    meta: "#A1A1AA",
    tint: 22,
    tintHover: 30,
    paleTint: 14,
    paleTintHover: 20,
    contrastTarget: "#FFFFFF",
  },
};

/** WCAG 1.4.11 non-text contrast for the marker/edge against the grid background. */
export const BLOCK_EDGE_MIN_CONTRAST = 3;
/** WCAG 1.4.3 text contrast for the block title and meta line. */
export const BLOCK_TEXT_MIN_CONTRAST = 4.5;
// Small safety margins: browsers mix in floating point, we round to 8-bit channels.
const EDGE_TARGET = BLOCK_EDGE_MIN_CONTRAST + 0.05;
const TEXT_TARGET = BLOCK_TEXT_MIN_CONTRAST + 0.05;

/** Above this luminance a category color is "light"; dark mode then starts from the paler tint. */
const LIGHT_COLOR_LUMINANCE = 0.45;
/** Used when the input is not a hex color (slate, the neutral "Other" preset). */
const FALLBACK_COLOR = "#7D8590";

export interface BlockColors {
  /** Color to use for the block (`--cat`): the input, or a contrast-adjusted variant. */
  color: string;
  /** True when `color` differs from the input because the input was too close to --grid-bg. */
  adjusted: boolean;
  /** Background tint, e.g. "22%". */
  tint: string;
  /** Hover background tint, e.g. "30%". */
  tintHover: string;
}

const cache = new Map<string, BlockColors>();
const CACHE_LIMIT = 512;

function computeEdge(hex: string, spec: BlockThemeSpec): string {
  if (contrastRatio(hex, spec.gridBg) >= EDGE_TARGET) return hex;
  // Smallest amount of contrastTarget (white in dark mode, black in light mode) that reaches 3:1.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mixHex(spec.contrastTarget, hex, mid), spec.gridBg) >= EDGE_TARGET) hi = mid;
    else lo = mid;
  }
  let weight = hi;
  let edge = mixHex(spec.contrastTarget, hex, weight);
  while (contrastRatio(edge, spec.gridBg) < EDGE_TARGET && weight < 1) {
    weight = Math.min(1, weight + 0.01);
    edge = mixHex(spec.contrastTarget, hex, weight);
  }
  return edge;
}

function computeTint(color: string, spec: BlockThemeSpec, start: number): number {
  let pct = start;
  while (pct > 0) {
    const fill = mixHex(color, spec.gridBg, pct / 100);
    if (contrastRatio(spec.text, fill) >= TEXT_TARGET && contrastRatio(spec.meta, fill) >= TEXT_TARGET) break;
    pct -= 1;
  }
  return pct;
}

/** Everything a task block needs to render `hex` legibly and perceivably in `theme`. */
export function blockColors(hex: string, theme: ThemeName): BlockColors {
  const input = normalizeHex(hex) ?? FALLBACK_COLOR;
  const key = `${theme}|${input}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const spec = BLOCK_THEMES[theme];
  const color = computeEdge(input, spec);
  const pale = theme === "dark" && luminance(color) > LIGHT_COLOR_LUMINANCE;
  const result: BlockColors = {
    color,
    adjusted: color !== input,
    tint: `${computeTint(color, spec, pale ? spec.paleTint : spec.tint)}%`,
    tintHover: `${computeTint(color, spec, pale ? spec.paleTintHover : spec.tintHover)}%`,
  };

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}

/**
 * Color to use as the block's `--cat` (marker, handles, fill source): the category color when it
 * has ≥ 3:1 against --grid-bg, otherwise a lightened (dark theme) / darkened (light theme)
 * variant of the same hue that does. Always "#RRGGBB".
 */
export function blockEdgeColor(hex: string, theme: ThemeName): string {
  return blockColors(hex, theme).color;
}

/**
 * Tint percentage for a task block background (`color-mix(in srgb, <cat> <tint>, var(--grid-bg))`).
 * Light 14%; dark 22% (14% for very light colors) — lowered when needed so title and meta text
 * keep ≥ 4.5:1. Presets always get exactly 14% / 22%.
 */
export function blockTint(hex: string, theme: ThemeName): string {
  return blockColors(hex, theme).tint;
}

/** Hover counterpart of blockTint(): light 20%; dark 30% (20% for very light colors), same rule. */
export function blockTintHover(hex: string, theme: ThemeName): string {
  return blockColors(hex, theme).tintHover;
}
