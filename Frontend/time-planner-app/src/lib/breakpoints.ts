// src/lib/breakpoints.ts — single source of truth for layout breakpoints.
// CSS media queries cannot read custom properties, so CSS repeats these numbers as
// `(max-width: 767.98px)` / `(min-width: 768px)`; keep both in sync.

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export type BreakpointName = keyof typeof BREAKPOINTS;

/** `(min-width: Npx)` */
export function minWidth(px: number): string {
  return `(min-width: ${px}px)`;
}

/** `(max-width: N-0.02px)` — the exclusive upper bound that pairs with minWidth(N). */
export function maxWidth(px: number): string {
  return `(max-width: ${px - 0.02}px)`;
}

/** Ready-made media queries for the app shells (see UI_PLAN §2 Breakpoints). */
export const MEDIA = {
  /** < 768: bottom tab bar, single-day planner, bottom sheets */
  mobile: maxWidth(BREAKPOINTS.md),
  /** 768–1023: icon rail, 7-day grid */
  tablet: `${minWidth(BREAKPOINTS.md)} and ${maxWidth(BREAKPOINTS.lg)}`,
  /** ≥ 1024: anchored editor, rail by default */
  desktop: minWidth(BREAKPOINTS.lg),
  /** ≥ 1280: expanded sidebar */
  wide: minWidth(BREAKPOINTS.xl),
  coarse: "(pointer: coarse)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  dark: "(prefers-color-scheme: dark)",
} as const;
