// Unit tests for src/lib/color.ts (time-zone independent; runs in every vitest project).
import { describe, expect, it } from "vitest";
import { CATEGORY_PRESETS, LEGACY_OTHER_COLOR } from "./categoryPalette";
import {
  BLOCK_EDGE_MIN_CONTRAST,
  BLOCK_TEXT_MIN_CONTRAST,
  blockColors,
  blockEdgeColor,
  blockTint,
  blockTintHover,
  contrastRatio,
  isHex,
  luminance,
  mixHex,
  normalizeHex,
  type ThemeName,
} from "./color";

/** Mirrors tokens.css: --grid-bg, --block-text (= --text-primary), --block-meta (= --text-secondary). */
const THEMES: Record<ThemeName, { bg: string; text: string; meta: string }> = {
  light: { bg: "#FFFFFF", text: "#18181B", meta: "#52525B" },
  dark: { bg: "#141416", text: "#EDEDEF", meta: "#A1A1AA" },
};
const BOTH: ThemeName[] = ["light", "dark"];

const percent = (value: string): number => {
  expect(value).toMatch(/^\d{1,3}%$/);
  return Number.parseInt(value, 10) / 100;
};

/** Every guarantee a task block needs, for one color in one theme. */
function expectPerceivableAndLegible(hex: string, theme: ThemeName): void {
  const t = THEMES[theme];
  const { color } = blockColors(hex, theme);
  expect(isHex(color)).toBe(true);
  // Marker / handles / edge: ≥ 3:1 against the grid background.
  expect(contrastRatio(color, t.bg)).toBeGreaterThanOrEqual(BLOCK_EDGE_MIN_CONTRAST);
  for (const tint of [blockTint(hex, theme), blockTintHover(hex, theme)]) {
    // Safe both when the adjusted color is used as --cat (recommended) and when the raw one is.
    for (const source of [color, normalizeHex(hex) ?? color]) {
      const fill = mixHex(source, t.bg, percent(tint));
      expect(contrastRatio(t.text, fill)).toBeGreaterThanOrEqual(BLOCK_TEXT_MIN_CONTRAST);
      expect(contrastRatio(t.meta, fill)).toBeGreaterThanOrEqual(BLOCK_TEXT_MIN_CONTRAST);
    }
  }
}

describe("color basics", () => {
  it("validates and normalises hex colors", () => {
    expect(isHex("#2F7FE0")).toBe(true);
    expect(isHex("#2f7fe0")).toBe(true);
    expect(isHex("#abc")).toBe(false);
    expect(isHex("2F7FE0")).toBe(false);
    expect(isHex(42)).toBe(false);
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex(" 2f7fe0 ")).toBe("#2F7FE0");
    expect(normalizeHex("nope")).toBeNull();
  });

  it("computes WCAG luminance and contrast", () => {
    expect(luminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBe(0);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    // Token values documented in tokens.css
    expect(contrastRatio("#18181B", "#FFFFFF")).toBeCloseTo(17.72, 1);
    expect(contrastRatio("#FFFFFF", "#4F5BD5")).toBeCloseTo(5.54, 1);
  });

  it("mixes like color-mix(in srgb, …)", () => {
    expect(mixHex("#FFFFFF", "#000000", 0.5)).toBe("#808080");
    expect(mixHex("#2F7FE0", "#FFFFFF", 1)).toBe("#2F7FE0");
    expect(mixHex("#2F7FE0", "#FFFFFF", 0)).toBe("#FFFFFF");
  });
});

describe("task block colors: presets keep the spec values", () => {
  it.each(BOTH)("%s theme: presets are unchanged and use the standard tints", (theme) => {
    for (const preset of CATEGORY_PRESETS) {
      const result = blockColors(preset.hex, theme);
      expect(result.color).toBe(preset.hex);
      expect(result.adjusted).toBe(false);
      expect(result.tint).toBe(theme === "light" ? "14%" : "22%");
      expect(result.tintHover).toBe(theme === "light" ? "20%" : "30%");
      expectPerceivableAndLegible(preset.hex, theme);
    }
    expectPerceivableAndLegible(LEGACY_OTHER_COLOR, theme);
  });
});

describe("task block colors: extreme user colors", () => {
  it("lifts a very dark color in dark mode so the block is visible", () => {
    const result = blockColors("#1A1A2E", "dark");
    expect(contrastRatio("#1A1A2E", THEMES.dark.bg)).toBeLessThan(BLOCK_EDGE_MIN_CONTRAST);
    expect(result.adjusted).toBe(true);
    expect(luminance(result.color)).toBeGreaterThan(luminance("#1A1A2E"));
    expect(contrastRatio(result.color, THEMES.dark.bg)).toBeGreaterThanOrEqual(3);
    // ...but only just enough: it stays a dark, muted color (not white).
    expect(contrastRatio(result.color, THEMES.dark.bg)).toBeLessThan(3.5);
    expect(blockEdgeColor("#1A1A2E", "dark")).toBe(result.color);
  });

  it("darkens a very pale color in light mode so the block is visible", () => {
    const result = blockColors("#FFFDE7", "light");
    expect(result.adjusted).toBe(true);
    expect(luminance(result.color)).toBeLessThan(luminance("#FFFDE7"));
    expect(contrastRatio(result.color, THEMES.light.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(result.color, THEMES.light.bg)).toBeLessThan(3.5);
  });

  it("leaves colors alone where they already contrast with the grid", () => {
    expect(blockColors("#000000", "light").adjusted).toBe(false);
    expect(blockColors("#FFFFFF", "dark").adjusted).toBe(false);
  });

  it("uses a paler tint for very light colors in dark mode", () => {
    expect(percent(blockTint("#FFFFFF", "dark"))).toBeLessThanOrEqual(0.14);
    expect(percent(blockTintHover("#FFFFFF", "dark"))).toBeLessThanOrEqual(0.2);
    expect(percent(blockTint("#FFFF00", "dark"))).toBeLessThanOrEqual(0.14);
  });

  it("keeps the light-theme tints for every color (meta text stays ≥ 4.5:1 even on black)", () => {
    for (const hex of ["#000000", "#FFFFFF", "#1A1A2E", "#FFFDE7", "#FF0000", "#0000FF"]) {
      expect(blockTint(hex, "light")).toBe("14%");
      expect(blockTintHover(hex, "light")).toBe("20%");
    }
  });

  it.each(BOTH)("%s theme: extremes are perceivable and legible", (theme) => {
    const extremes = [
      "#000000",
      "#FFFFFF",
      "#141416", // identical to the dark grid
      "#1A1A2E",
      "#202020",
      "#FFFDE7",
      "#F5F5DC",
      "#EEEEEE",
      "#FFFF00",
      "#00FFFF",
      "#FF0000",
      "#0000FF",
      "#00FF00",
      "#808080",
    ];
    for (const hex of extremes) expectPerceivableAndLegible(hex, theme);
  });

  it("falls back to the neutral color for invalid input", () => {
    for (const theme of BOTH) {
      expect(blockColors("not-a-color", theme).color).toBe("#7D8590");
      expectPerceivableAndLegible("not-a-color", theme);
    }
  });

  it("accepts 3-digit and lower-case hex input", () => {
    expect(blockColors("#2f7fe0", "dark").color).toBe("#2F7FE0");
    expect(blockColors("#000", "light").color).toBe("#000000");
  });
});

describe("task block colors: exhaustive sweep", () => {
  it.each(BOTH)("%s theme: 4096 colors are all perceivable and legible", (theme) => {
    const steps = Array.from({ length: 16 }, (_, i) => i * 17);
    let checked = 0;
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          expectPerceivableAndLegible(hex, theme);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(4096);
  });
});
