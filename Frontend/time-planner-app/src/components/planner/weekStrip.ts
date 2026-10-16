// src/components/planner/weekStrip.ts — pure logic of the phone day strip (WeekStrip.vue).
// No DOM: the component feeds it the scroll position and the week width and acts on the results.
//
// Model:
// - The strip renders a WINDOW of whole ISO weeks (Monday..Sunday) around an anchor week:
//   `radiusWeeks` on each side, so 13 weeks / 91 day pills — a modest DOM that still leaves
//   several weeks of native scrolling in either direction.
// - One week fills the strip's width and scroll-snap stops at each Monday, so a settled strip
//   always shows exactly one Mon–Sun week (the owner thinks in week numbers).
// - When scrolling settles within `edgeWeeks` of either end, the window is re-centred on the
//   shown week; the caller rebases scrollLeft by the whole weeks that were added/removed at the
//   front, so the same week stays on screen without a visible jump.
// - Scrolling only reveals days; selecting is a tap/Enter. When the selected day changes by
//   other means, the strip scrolls to its week (or rebuilds the window around it when it is not
//   rendered).
// All date math goes through src/lib/datetime.ts (ISO week-year aware: 2027-01-01 is 2026-W53).

import {
  addDays,
  diffCalendarDays,
  formatDate,
  formatDayOfMonth,
  formatWeekNumber,
  isoWeekOf,
  isoWeekday,
  type DateKey,
  type IsoWeekRef,
} from "@/lib/datetime";
import { formatWeekdayMicro } from "@/lib/plannerFormat";

export const STRIP = {
  /** Weeks rendered on each side of the anchor week (13 weeks, 91 pills in total). */
  radiusWeeks: 6,
  /** Re-centre once the shown week is fewer than this many weeks from either end. */
  edgeWeeks: 3,
  /** Scrolling counts as settled after this long without scroll events (Safari has no scrollend). */
  settleMs: 150,
  /** A scroll position within this many px of a target counts as already there. */
  tolerancePx: 1,
} as const;

/** The rendered weeks: `weeks` consecutive ISO weeks starting on Monday `start`. */
export interface StripWindow {
  start: DateKey;
  weeks: number;
}

export interface StripDay {
  key: DateKey;
  /** "MON" */
  weekday: string;
  /** "12" */
  date: string;
  /** "Monday, October 12, 2026, week 42" (locale-dependent date). */
  label: string;
}

export interface StripWeek {
  monday: DateKey;
  week: IsoWeekRef;
  /** "W42": the visible week-boundary marker. */
  label: string;
  /** "Week 42": accessible name of the week's group. */
  ariaLabel: string;
  days: StripDay[];
}

/** Monday of the ISO week containing `day`. */
export function mondayOf(day: DateKey): DateKey {
  return addDays(day, 1 - isoWeekday(day));
}

/** A window of `2 × radius + 1` weeks centred on the week containing `day`. */
export function stripWindowAround(day: DateKey, radius: number = STRIP.radiusWeeks): StripWindow {
  return { start: addDays(mondayOf(day), -7 * radius), weeks: 2 * radius + 1 };
}

/** Index of the week containing `day` (negative / ≥ weeks when it is outside the window). */
export function weekIndexOf(win: StripWindow, day: DateKey): number {
  return Math.floor(diffCalendarDays(day, win.start) / 7);
}

/** Is `day` rendered? */
export function windowContains(win: StripWindow, day: DateKey): boolean {
  const index = weekIndexOf(win, day);
  return index >= 0 && index < win.weeks;
}

/** "Monday, October 12, 2026, week 42" — the full date plus its ISO week. */
export function stripDayLabel(day: DateKey): string {
  return `${formatDate(day, "full")}, ${formatWeekNumber(isoWeekOf(day).week, "long").toLowerCase()}`;
}

/** Accessible name of a day pill: the full label plus ", today" / ", has tasks". */
export function stripDayAriaLabel(label: string, isToday: boolean, busy: boolean): string {
  let text = label;
  if (isToday) text += ", today";
  if (busy) text += ", has tasks";
  return text;
}

/** The weeks of a window, with their days and labels (static for a given window). */
export function stripWeeks(win: StripWindow): StripWeek[] {
  return Array.from({ length: win.weeks }, (_, w) => {
    const monday = addDays(win.start, 7 * w);
    const week = isoWeekOf(monday);
    return {
      monday,
      week,
      label: formatWeekNumber(week.week, "short"),
      ariaLabel: formatWeekNumber(week.week, "long"),
      days: Array.from({ length: 7 }, (_, d) => {
        const key = addDays(monday, d);
        return {
          key,
          weekday: formatWeekdayMicro(key),
          date: formatDayOfMonth(key),
          label: stripDayLabel(key),
        };
      }),
    };
  });
}

/** The week shown at `scrollLeft` (nearest snap position), clamped to the window. */
export function shownWeekIndex(scrollLeft: number, weekWidth: number, weeks: number): number {
  if (!(weekWidth > 0) || weeks <= 0) return 0;
  return Math.min(weeks - 1, Math.max(0, Math.round(scrollLeft / weekWidth)));
}

export interface Recentring {
  win: StripWindow;
  /** Index of the shown week in the new window. */
  shownIndex: number;
}

/**
 * After scrolling settled on week `shownIndex`: when it is fewer than `edgeWeeks` weeks from
 * either end, a window of the same size centred on it (and its index there); otherwise `null`.
 */
export function recenterStrip(
  win: StripWindow,
  shownIndex: number,
  edgeWeeks: number = STRIP.edgeWeeks
): Recentring | null {
  if (shownIndex >= edgeWeeks && shownIndex <= win.weeks - 1 - edgeWeeks) return null;
  const radius = Math.floor(win.weeks / 2);
  const monday = addDays(win.start, 7 * shownIndex);
  return { window: { start: addDays(monday, -7 * radius), weeks: win.weeks }, shownIndex: radius };
}

/**
 * The scrollLeft that keeps the same content on screen after the window changed from `from` to
 * `to`: weeks prepended in front push it right, weeks removed from the front pull it left.
 */
export function rebasedScrollLeft(
  scrollLeft: number,
  weekWidth: number,
  from: StripWindow,
  to: StripWindow
): number {
  const weeksAdded = diffCalendarDays(from.start, to.start) / 7;
  return scrollLeft + weeksAdded * weekWidth;
}

/** scrollLeft of the snap position that shows the week containing `day` (inside the window). */
export function weekScrollLeft(win: StripWindow, day: DateKey, weekWidth: number): number {
  return weekIndexOf(win, day) * weekWidth;
}

/**
 * Where to scroll so `day` is visible: the scrollLeft of its week, or `null` when nothing needs
 * to move (its week is already shown, the strip is not laid out, or the day is not rendered —
 * the caller rebuilds the window first in that case).
 */
export function stripScrollTarget(
  win: StripWindow,
  day: DateKey,
  weekWidth: number,
  scrollLeft: number
): number | null {
  if (!(weekWidth > 0) || !windowContains(win, day)) return null;
  const target = weekScrollLeft(win, day, weekWidth);
  return Math.abs(scrollLeft - target) <= STRIP.tolerancePx ? null : target;
}

/** What the strip does to show `day` (after the selection changed, or keyboard focus moved). */
export type RevealPlan =
  | { kind: "none" }
  | { kind: "scroll"; left: number }
  /** The day is not rendered: replace the window by one centred on it and jump there. */
  | { kind: "rebuild"; window: StripWindow; left: number };

export function planReveal(
  win: StripWindow,
  day: DateKey,
  weekWidth: number,
  scrollLeft: number
): RevealPlan {
  if (!windowContains(win, day)) {
    const next = stripWindowAround(day, Math.floor(win.weeks / 2));
    return { kind: "rebuild", window: next, left: Math.max(0, weekScrollLeft(next, day, weekWidth)) };
  }
  const target = stripScrollTarget(win, day, weekWidth, scrollLeft);
  return target === null ? { kind: "none" } : { kind: "scroll", left: target };
}

/**
 * Keyboard model (roving focus, one day per step, across weeks): ←/→ previous/next day,
 * Home/End Monday/Sunday of the focused day's week, PageUp/PageDown the same weekday one week
 * earlier/later. Enter/Space select (native button activation). `null` = key not handled.
 */
export function moveStripFocus(day: DateKey, key: string): DateKey | null {
  switch (key) {
    case "ArrowLeft":
      return addDays(day, -1);
    case "ArrowRight":
      return addDays(day, 1);
    case "Home":
      return mondayOf(day);
    case "End":
      return addDays(mondayOf(day), 6);
    case "PageUp":
      return addDays(day, -7);
    case "PageDown":
      return addDays(day, 7);
    default:
      return null;
  }
}

/**
 * The pill that carries tabindex="0" (roving tabindex): the last keyboard-focused day while
 * focus is in the strip, else the selected day, else (both scrolled out of the window) the
 * Monday of the shown week. `shownIndex` is a thunk so it is only read in that last case.
 */
export function stripTabStop(
  win: StripWindow,
  focused: DateKey | null,
  selected: DateKey,
  shownIndex: () => number
): DateKey {
  if (focused && windowContains(win, focused)) return focused;
  if (windowContains(win, selected)) return selected;
  const index = Math.min(win.weeks - 1, Math.max(0, shownIndex()));
  return addDays(win.start, 7 * index);
}
