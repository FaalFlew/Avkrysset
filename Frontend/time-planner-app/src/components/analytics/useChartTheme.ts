// src/components/analytics/useChartTheme.ts — Chart.js colors, fonts and motion read from the
// design tokens (tokens.css), re-evaluated whenever the resolved theme or the reduced-motion
// preference changes, so charts re-theme live when the user toggles light/dark. In print mode
// (usePrintMode) the light tokens are re-read and animation is off.

import { computed, type ComputedRef } from "vue";
import { useTheme } from "@/composables/useTheme";
import { useBreakpoint } from "@/composables/useMediaQuery";
import { printState } from "@/composables/usePrintMode";

export interface ChartTheme {
  isDark: boolean;
  /** Axis tick and label text. */
  text: string;
  textMuted: string;
  /** Hairline gridlines. */
  grid: string;
  axis: string;
  /** The single series color of the bar chart. */
  bar: string;
  barHover: string;
  /** "Other"/"n more" and categories without a color. */
  neutral: string;
  /** Gap drawn between donut segments (the card surface). */
  sliceGap: string;
  surface: string;
  tooltipBg: string;
  tooltipText: string;
  tooltipTextSecondary: string;
  fontFamily: string;
  /** 200ms, or 0 under prefers-reduced-motion and while printing. */
  animationMs: number;
  /** Print mode: light tokens, no animation (charts are redrawn for paper). */
  printMode: boolean;
}

/** Light-theme token values, used if a token cannot be read (e.g. no DOM). */
const FALLBACK: Omit<ChartTheme, "isDark" | "animationMs" | "printMode"> = {
  text: "#52525B",
  textMuted: "#67676F",
  grid: "#EDEDF0",
  axis: "#D4D4D8",
  bar: "#4F5BD5",
  barHover: "#434DC0",
  neutral: "#A1A1AA",
  sliceGap: "#FFFFFF",
  surface: "#FFFFFF",
  tooltipBg: "#1C1C21",
  tooltipText: "#F4F4F5",
  tooltipTextSecondary: "#A1A1AA",
  fontFamily: "Inter Variable, Inter, system-ui, sans-serif",
};

function readTokens(): Omit<ChartTheme, "isDark" | "animationMs" | "printMode"> {
  if (typeof document === "undefined") return FALLBACK;
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    text: token("--chart-text", FALLBACK.text),
    textMuted: token("--chart-text-muted", FALLBACK.textMuted),
    grid: token("--chart-grid", FALLBACK.grid),
    axis: token("--chart-axis", FALLBACK.axis),
    bar: token("--chart-bar", FALLBACK.bar),
    barHover: token("--chart-bar-hover", FALLBACK.barHover),
    neutral: token("--chart-neutral", FALLBACK.neutral),
    sliceGap: token("--chart-slice-gap", FALLBACK.sliceGap),
    surface: token("--bg-surface", FALLBACK.surface),
    tooltipBg: token("--bg-inverse", FALLBACK.tooltipBg),
    tooltipText: token("--text-inverse", FALLBACK.tooltipText),
    tooltipTextSecondary: token("--text-inverse-secondary", FALLBACK.tooltipTextSecondary),
    fontFamily: token("--font-sans", FALLBACK.fontFamily),
  };
}

export function useChartTheme(): ComputedRef<ChartTheme> {
  const { resolvedTheme } = useTheme();
  const { prefersReducedMotion } = useBreakpoint();

  return computed(() => {
    // Dependencies: the theme (tokens are switched by <html data-theme>), reduced motion and
    // print mode (which forces data-theme="light" before it flips, so the tokens read here are
    // the light ones).
    const printMode = printState.active;
    const isDark = !printMode && resolvedTheme.value === "dark";
    return {
      ...readTokens(),
      isDark,
      animationMs: printMode || prefersReducedMotion.value ? 0 : 200,
      printMode,
    };
  });
}

/** Shared tooltip styling (inverse surface, Inter 12px, no color boxes: values lead). */
export function tooltipStyle(theme: ChartTheme) {
  return {
    backgroundColor: theme.tooltipBg,
    titleColor: theme.tooltipText,
    bodyColor: theme.tooltipText,
    footerColor: theme.tooltipTextSecondary,
    titleFont: { family: theme.fontFamily, size: 12, weight: 500 },
    bodyFont: { family: theme.fontFamily, size: 12, weight: 600 },
    footerFont: { family: theme.fontFamily, size: 12, weight: 400 },
    padding: { top: 8, bottom: 8, left: 10, right: 10 },
    cornerRadius: 8,
    caretSize: 5,
    displayColors: false,
    titleMarginBottom: 4,
    footerMarginTop: 6,
  } as const;
}
