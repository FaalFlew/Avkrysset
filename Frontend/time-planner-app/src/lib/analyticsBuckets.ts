/**
 * Pure bucketing rules for the analytics view, shared by guest mode (computed locally) and
 * authenticated mode (server breakdown mapped onto the same buckets).
 *
 * Bucket keys match the API's `BreakdownDataPoint.key`:
 * - monthly: `"yyyy-MM"` (calendar month in the active zone)
 * - weekly:  `"yyyy-Www"` (ISO week, e.g. `"2026-W05"`)
 * - daily:   `"yyyy-MM-dd"` (calendar date in the active zone)
 */
import type { BreakdownDataPoint } from "@/types";
import {
  addDays,
  dateKeyFromParts,
  dateKeyParts,
  formatWeekdayDay,
  isoWeekKey,
  isoWeekOf,
  isoWeekStartKey,
  isoWeeksInYear,
  isoWeeksRange,
  monthKey,
  monthKeyOf,
  monthNames,
  monthsRange,
  toDateKey,
  weekDaysOf,
  type DateKey,
  type InstantInput,
  type InstantRange,
} from "./datetime";

export type AnalyticsView = "monthly" | "weekly" | "daily";

export interface AnalyticsSelection {
  view: AnalyticsView;
  /** Calendar year for `"monthly"`; ISO week-year for `"weekly"` and `"daily"`. */
  year: number;
  /** 0-based months, inclusive. */
  monthRange: { start: number; end: number };
  /** ISO week numbers, inclusive. */
  weekRange: { start: number; end: number };
  /** ISO week shown by the daily view. */
  dailyWeek: number;
}

export interface AnalyticsBucket {
  key: string;
  label: string;
}

export interface BreakdownBar extends AnalyticsBucket {
  value: number;
  color: string;
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

/** Clamp an ISO week number into `1..isoWeeksInYear(isoYear)`. */
export function clampIsoWeek(isoYear: number, week: number): number {
  return clamp(Math.round(week) || 1, 1, isoWeeksInYear(isoYear));
}

function normalized(sel: AnalyticsSelection) {
  const monthStart = clamp(sel.monthRange.start, 0, 11);
  const weekStart = clampIsoWeek(sel.year, sel.weekRange.start);
  return {
    monthStart,
    monthEnd: clamp(sel.monthRange.end, monthStart, 11),
    weekStart,
    weekEnd: clamp(clampIsoWeek(sel.year, sel.weekRange.end), weekStart, 53),
    dailyWeek: clampIsoWeek(sel.year, sel.dailyWeek),
  };
}

/** Half-open instant range covered by the selection (what the API is asked for). */
export function analyticsRange(sel: AnalyticsSelection): InstantRange {
  const n = normalized(sel);
  switch (sel.view) {
    case "monthly":
      return monthsRange(sel.year, n.monthStart, n.monthEnd);
    case "weekly":
      return isoWeeksRange(sel.year, n.weekStart, n.weekEnd);
    case "daily":
      return isoWeeksRange(sel.year, n.dailyWeek, n.dailyWeek);
  }
}

/** Every bucket in the selected range, in chronological order (zero-filled by the caller). */
export function analyticsBuckets(sel: AnalyticsSelection): AnalyticsBucket[] {
  const n = normalized(sel);
  switch (sel.view) {
    case "monthly": {
      const names = monthNames("long");
      const buckets: AnalyticsBucket[] = [];
      for (let m = n.monthStart; m <= n.monthEnd; m++) {
        buckets.push({ key: monthKey(sel.year, m), label: names[m] });
      }
      return buckets;
    }
    case "weekly": {
      const buckets: AnalyticsBucket[] = [];
      for (let w = n.weekStart; w <= n.weekEnd; w++) {
        buckets.push({ key: isoWeekKey({ isoYear: sel.year, week: w }), label: `Week ${w}` });
      }
      return buckets;
    }
    case "daily":
      return weekDaysOf(isoWeekStartKey(sel.year, n.dailyWeek)).map((key) => ({
        key,
        label: formatWeekdayDay(key),
      }));
  }
}

/** Bucket key of a task start for the given view (local calendar of the active zone). */
export function bucketKeyOf(view: AnalyticsView, start: InstantInput): string {
  switch (view) {
    case "monthly":
      return monthKeyOf(start);
    case "weekly":
      return isoWeekKey(isoWeekOf(start));
    case "daily":
      return toDateKey(start);
  }
}

const ENGLISH_MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
/** .NET `DayOfWeek` names, Sunday first (index 0 = Sunday). */
const ENGLISH_WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

/**
 * Map a breakdown label from a backend that predates `key` onto a bucket key.
 * Old labels: month names (server culture), `"Week N"`, and .NET weekday names (`"Monday"`).
 * Returns `null` when the label is not recognised.
 */
export function legacyBreakdownKey(sel: AnalyticsSelection, label: string): string | null {
  const text = label.trim().toLowerCase();
  switch (sel.view) {
    case "monthly": {
      const candidates = [
        ENGLISH_MONTHS,
        monthNames("long").map((m) => m.toLowerCase()),
        monthNames("short").map((m) => m.toLowerCase()),
      ];
      for (const names of candidates) {
        const index = names.indexOf(text);
        if (index >= 0) return monthKey(sel.year, index);
      }
      return null;
    }
    case "weekly": {
      const match = /(\d{1,2})/.exec(text);
      if (!match) return null;
      const week = Number(match[1]);
      if (week < 1 || week > isoWeeksInYear(sel.year)) return null;
      return isoWeekKey({ isoYear: sel.year, week });
    }
    case "daily": {
      const dayIndex = ENGLISH_WEEKDAYS.indexOf(text);
      if (dayIndex < 0) return null;
      const isoDay = dayIndex === 0 ? 7 : dayIndex;
      const monday = isoWeekStartKey(sel.year, normalized(sel).dailyWeek);
      return addDays(monday, isoDay - 1);
    }
  }
}

/**
 * Spread a server breakdown over every bucket of the selection (missing buckets = 0, neutral
 * color). Items are matched by `key`, falling back to the legacy label. Returns `null` if any
 * item cannot be placed, so the caller can show the server's (sparse) data as-is instead.
 */
export function densifyBreakdown(
  sel: AnalyticsSelection,
  items: BreakdownDataPoint[],
  neutralColor: string
): BreakdownBar[] | null {
  const byKey = new Map<string, BreakdownDataPoint>();
  for (const item of items) {
    const key = item.key || legacyBreakdownKey(sel, item.label);
    if (!key) return null;
    byKey.set(key, item);
  }
  const buckets = analyticsBuckets(sel);
  if ([...byKey.keys()].some((key) => !buckets.some((b) => b.key === key))) return null;
  return buckets.map((bucket) => {
    const item = byKey.get(bucket.key);
    return {
      ...bucket,
      value: item?.value ?? 0,
      color: item?.dominantCategoryColor || neutralColor,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Year pickers: calendar years (Month view) vs ISO week-years (Week / Day views)
// ---------------------------------------------------------------------------------------------

/** Distinct years, newest first. */
function sortedYears(years: Iterable<number>): number[] {
  return [...new Set(years)].filter(Number.isFinite).sort((a, b) => b - a);
}

/**
 * ISO week-years that can contain dates of the given calendar years, newest first: each calendar
 * year Y maps to Y, plus Y-1 when Jan 1 falls in the previous week-year and Y+1 when Dec 31
 * falls in week 1 of the next (2024-12-30/31 are in 2025-W01). Use it when only calendar years
 * are known (the API's year list); with the tasks at hand prefer their exact isoWeekOf().
 */
export function isoWeekYearsOfCalendarYears(years: Iterable<number>): number[] {
  const result: number[] = [];
  for (const year of years) {
    result.push(
      isoWeekOf(dateKeyFromParts(year, 0, 1)).isoYear,
      year,
      isoWeekOf(dateKeyFromParts(year, 11, 31)).isoYear
    );
  }
  return sortedYears(result);
}

/** Calendar years and ISO week-years of a list of instants (e.g. task starts), newest first. */
export function yearsOfInstants(starts: Iterable<InstantInput>): {
  calendarYears: number[];
  isoYears: number[];
} {
  const calendar: number[] = [];
  const iso: number[] = [];
  for (const start of starts) {
    const key = toDateKey(start);
    calendar.push(dateKeyParts(key).year);
    iso.push(isoWeekOf(key).isoYear);
  }
  return { calendarYears: sortedYears(calendar), isoYears: sortedYears(iso) };
}

export interface AnalyticsPeriodDefaults {
  /** Year of the Month view (calendar year). */
  calendarYear: number;
  /** Year of the Week and Day views (ISO week-year). */
  isoYear: number;
  /** Week shown by the Day view. */
  dailyWeek: number;
}

/**
 * Where the analytics filters start: the current calendar year / ISO week-year (on 2027-01-01,
 * which is 2026-W53, the Week and Day views open on 2026), or the newest year with data when
 * there is none in the current one.
 */
export function defaultAnalyticsPeriod(
  today: DateKey,
  calendarYears: readonly number[],
  isoYears: readonly number[]
): AnalyticsPeriodDefaults {
  const thisYear = dateKeyParts(today).year;
  const thisWeek = isoWeekOf(today);
  const pick = (available: readonly number[], preferred: number) =>
    available.length === 0 || available.includes(preferred)
      ? preferred
      : sortedYears(available)[0]!;
  const calendarYear = pick(calendarYears, thisYear);
  const isoYear = pick(isoYears, thisWeek.isoYear);
  return { calendarYear, isoYear, dailyWeek: defaultDailyWeek(today, isoYear) };
}

/** This week if it belongs to `isoYear`; otherwise the end of that week-year nearest to today. */
export function defaultDailyWeek(today: DateKey, isoYear: number): number {
  const thisWeek = isoWeekOf(today);
  if (thisWeek.isoYear === isoYear) return thisWeek.week;
  return thisWeek.isoYear < isoYear ? 1 : isoWeeksInYear(isoYear);
}
