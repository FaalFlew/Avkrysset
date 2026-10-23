// src/components/analytics/format.ts — analytics labels, built only on the datetime helper's
// primitives (no Date/dayjs here; see the architecture test).

import {
  addDays,
  formatDate,
  formatDateRange,
  formatMonthYear,
  formatWeekdayDay,
  isDateKey,
  isoWeekStartKey,
  monthNames,
} from "@/lib/datetime";
import type { AnalyticsSelection, AnalyticsView } from "@/lib/analyticsBuckets";
import { pluralize } from "@/lib/format";

const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const WEEK_KEY = /^(\d{4})-W(\d{2})$/;

function parseMonthKey(key: string): { year: number; monthIndex: number } | null {
  const m = MONTH_KEY.exec(key);
  return m ? { year: Number(m[1]), monthIndex: Number(m[2]) - 1 } : null;
}

function parseWeekKey(key: string): { isoYear: number; week: number } | null {
  const m = WEEK_KEY.exec(key);
  return m ? { isoYear: Number(m[1]), week: Number(m[2]) } : null;
}

/** Monday and Sunday (DateKeys) of an ISO week. */
export function isoWeekBounds(isoYear: number, week: number): { start: string; end: string } {
  const start = isoWeekStartKey(isoYear, week);
  return { start, end: addDays(start, 6) };
}

/** Axis label for a bucket key: "Jan", "W14", "Mon 5". Unknown keys are returned as-is. */
export function shortBucketLabel(view: AnalyticsView, key: string): string {
  if (view === "monthly") {
    const p = parseMonthKey(key);
    return p ? monthNames("short")[p.monthIndex] ?? key : key;
  }
  if (view === "weekly") {
    const p = parseWeekKey(key);
    return p ? `W${p.week}` : key;
  }
  return isDateKey(key) ? formatWeekdayDay(key) : key;
}

/** Tooltip/table label: "March 2026", "Week 14 · Mar 30 – Apr 5, 2026", "Mon, Oct 5". */
export function fullBucketLabel(view: AnalyticsView, key: string): string {
  if (view === "monthly") {
    const p = parseMonthKey(key);
    return p ? formatMonthYear(p.year, p.monthIndex) : key;
  }
  if (view === "weekly") {
    const p = parseWeekKey(key);
    if (!p) return key;
    const { start, end } = isoWeekBounds(p.isoYear, p.week);
    return `Week ${p.week} · ${formatDateRange(start, end)}`;
  }
  return isDateKey(key) ? formatDate(key, "weekdayShort") : key;
}

/** "month" / "week" / "day" */
export function periodNoun(view: AnalyticsView): string {
  return view === "monthly" ? "month" : view === "weekly" ? "week" : "day";
}

/** "12 months", "1 week", "7 days" */
export function periodCount(view: AnalyticsView, count: number): string {
  return pluralize(count, periodNoun(view));
}

/** Option label for a week picker: "W40 · Sep 28". */
export function weekStartOptionLabel(isoYear: number, week: number): string {
  return `W${week} · ${formatDate(isoWeekStartKey(isoYear, week), "monthDay")}`;
}

/** Option label for a single-week picker: "W40 · Sep 28 – Oct 4, 2026". */
export function weekRangeOptionLabel(isoYear: number, week: number): string {
  const { start, end } = isoWeekBounds(isoYear, week);
  return `W${week} · ${formatDateRange(start, end)}`;
}

/**
 * Human summary of the selection, used as the page subtitle and chart captions:
 * "Jan – Dec 2026 · 12 months", "Weeks 1–53 · Dec 29, 2025 – Jan 3, 2027",
 * "Week 40 · Sep 28 – Oct 4, 2026".
 */
export function selectionSummary(sel: AnalyticsSelection, periods: number): string {
  if (sel.view === "monthly") {
    const names = monthNames("short");
    const { start, end } = sel.monthRange;
    const span =
      start === end
        ? formatMonthYear(sel.year, start)
        : `${names[start]} – ${names[end]} ${sel.year}`;
    return `${span} · ${periodCount("monthly", periods)}`;
  }
  if (sel.view === "weekly") {
    const { start, end } = sel.weekRange;
    const first = isoWeekBounds(sel.year, start).start;
    const last = isoWeekBounds(sel.year, end).end;
    const weeks = start === end ? `Week ${start}` : `Weeks ${start}–${end}`;
    return `${weeks} · ${formatDateRange(first, last)}`;
  }
  const { start, end } = isoWeekBounds(sel.year, sel.dailyWeek);
  return `Week ${sel.dailyWeek} · ${formatDateRange(start, end)}`;
}

/** Short scope label for KPI subs: "Jan – Dec 2026", "W1–W53 2026", "Week 40, 2026". */
export function selectionShortLabel(sel: AnalyticsSelection): string {
  if (sel.view === "monthly") {
    const names = monthNames("short");
    const { start, end } = sel.monthRange;
    return start === end
      ? formatMonthYear(sel.year, start)
      : `${names[start]} – ${names[end]} ${sel.year}`;
  }
  if (sel.view === "weekly") {
    const { start, end } = sel.weekRange;
    return start === end ? `Week ${start}, ${sel.year}` : `W${start}–W${end} ${sel.year}`;
  }
  return `Week ${sel.dailyWeek}, ${sel.year}`;
}

/** Shorten a user-provided name for canvas tooltips (which cannot ellipsize): "Side project wi…". */
export function clipName(name: string, max = 28): string {
  const chars = Array.from(name.trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}
