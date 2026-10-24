// src/components/planner/weekPicker.ts — pure logic of the week-number picker
// (CalendarDatePicker): ISO weeks of an ISO week-year, year pages, keyboard moves, labels.
// All date math goes through src/lib/datetime.ts (ISO week-year aware: 2026 has 53 weeks,
// 2027-01-01 belongs to 2026-W53, 2027-W01 starts on 2027-01-04).

import {
  addDays,
  formatDateRange,
  formatWeekNumber,
  isoWeekStartKey,
  isoWeekday,
  isoWeeksInYear,
  type DateKey,
} from "@/lib/datetime";

/** Earliest year the picker offers. */
export const MIN_PICKER_YEAR = 1970;
/** Years per page in the year grid, and its columns. */
export const YEARS_PER_PAGE = 12;
export const YEAR_COLUMNS = 4;

export interface WeekCell {
  week: number;
  /** Monday of the week. */
  start: DateKey;
  /** Sunday of the week. */
  end: DateKey;
  /** "Week 41 · Oct 5 – 11, 2026" (locale-dependent date range). */
  label: string;
}

/** "Week 41 · Oct 5 – 11, 2026" for ISO week `week` of `isoYear`. */
export function weekLabel(isoYear: number, week: number): string {
  const start = isoWeekStartKey(isoYear, week);
  return `${formatWeekNumber(week, "long")} · ${formatDateRange(start, addDays(start, 6))}`;
}

/** Every ISO week (52 or 53) of an ISO week-year. */
export function weekCells(isoYear: number): WeekCell[] {
  return Array.from({ length: isoWeeksInYear(isoYear) }, (_, i) => {
    const week = i + 1;
    const start = isoWeekStartKey(isoYear, week);
    return { week, start, end: addDays(start, 6), label: weekLabel(isoYear, week) };
  });
}

/**
 * The planner date for picking week `week` of `isoYear`: that week's day with the same weekday
 * as `currentDate`, so the phone day view keeps showing e.g. Wednesdays (the 7-day view shows the
 * whole week either way).
 */
export function selectWeekDate(isoYear: number, week: number, currentDate: DateKey): DateKey {
  return addDays(isoWeekStartKey(isoYear, week), isoWeekday(currentDate) - 1);
}

export interface WeekRef {
  isoYear: number;
  week: number;
}

/**
 * Keyboard move in the week grid (`columns` per row). ←/→ ±1 week (crossing into the previous/
 * next year), ↑/↓ ±1 row (staying inside the year), Home/End first/last week, PageUp/PageDown
 * the same week of the previous/next year (clamped to its week count). `null` = key not handled.
 */
export function moveWeekFocus(from: WeekRef, key: string, columns: number): WeekRef | null {
  const { isoYear, week } = from;
  const last = isoWeeksInYear(isoYear);
  switch (key) {
    case "ArrowLeft":
      if (week > 1) return { isoYear, week: week - 1 };
      if (isoYear - 1 < MIN_PICKER_YEAR) return from;
      return { isoYear: isoYear - 1, week: isoWeeksInYear(isoYear - 1) };
    case "ArrowRight":
      if (week < last) return { isoYear, week: week + 1 };
      return { isoYear: isoYear + 1, week: 1 };
    case "ArrowUp":
      return week - columns >= 1 ? { isoYear, week: week - columns } : from;
    case "ArrowDown":
      return week + columns <= last ? { isoYear, week: week + columns } : from;
    case "Home":
      return { isoYear, week: 1 };
    case "End":
      return { isoYear, week: last };
    case "PageUp":
      if (isoYear - 1 < MIN_PICKER_YEAR) return from;
      return { isoYear: isoYear - 1, week: Math.min(week, isoWeeksInYear(isoYear - 1)) };
    case "PageDown":
      return { isoYear: isoYear + 1, week: Math.min(week, isoWeeksInYear(isoYear + 1)) };
    default:
      return null;
  }
}

/** First year of the page that shows `year` roughly centered (never before MIN_PICKER_YEAR). */
export function yearPageStart(year: number): number {
  return Math.max(MIN_PICKER_YEAR, year - Math.floor(YEARS_PER_PAGE / 2));
}

/** The years of a page. */
export function yearPage(start: number): number[] {
  return Array.from({ length: YEARS_PER_PAGE }, (_, i) => start + i);
}

/**
 * Keyboard move in the year grid: ←/→ ±1, ↑/↓ ±1 row, Home/End first/last of the page,
 * PageUp/PageDown ±1 page. The page follows the focused year. `null` = key not handled.
 */
export function moveYearFocus(
  year: number,
  pageStart: number,
  key: string
): { year: number; pageStart: number } | null {
  let next: number;
  switch (key) {
    case "ArrowLeft":
      next = year - 1;
      break;
    case "ArrowRight":
      next = year + 1;
      break;
    case "ArrowUp":
      next = year - YEAR_COLUMNS;
      break;
    case "ArrowDown":
      next = year + YEAR_COLUMNS;
      break;
    case "Home":
      next = pageStart;
      break;
    case "End":
      next = pageStart + YEARS_PER_PAGE - 1;
      break;
    case "PageUp":
      next = year - YEARS_PER_PAGE;
      break;
    case "PageDown":
      next = year + YEARS_PER_PAGE;
      break;
    default:
      return null;
  }
  next = Math.max(MIN_PICKER_YEAR, next);
  let start = pageStart;
  while (next < start) start -= YEARS_PER_PAGE;
  while (next > start + YEARS_PER_PAGE - 1) start += YEARS_PER_PAGE;
  return { year: next, pageStart: Math.max(MIN_PICKER_YEAR, start) };
}
