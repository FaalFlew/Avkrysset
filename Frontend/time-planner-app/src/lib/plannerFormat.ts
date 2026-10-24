// src/lib/plannerFormat.ts — planner/Today display strings and small time helpers.
//
// Built only on the primitives of src/lib/datetime.ts (no dayjs, no native Date here), so the
// time-zone and locale rules stay in one module. Everything follows the browser locale
// (12h/24h comes from formatTime / formatTimeOfDay).

import {
  addDays,
  addMinutes,
  atMinutesOfDay,
  diffCalendarDays,
  endInstant,
  formatDate,
  formatDateRange,
  formatDuration,
  formatMonthSpan,
  formatTime,
  formatTimeRange,
  formatUtcOffset,
  formatWeekdayLong,
  formatWeekdayShort,
  isoWeekOf,
  minutesSinceStartOfDay,
  now,
  splitInstant,
  toDateKey,
  todayKey,
  type DateKey,
  type InstantInput,
  type UtcIsoString,
} from "@/lib/datetime";
import { pluralize } from "@/lib/format";

/** Planner title for the visible days: "October 2026", "Sep – Oct 2026", "Dec 2026 – Jan 2027". */
export function formatPlannerTitle(days: readonly DateKey[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";
  return formatMonthSpan(first, last);
}

/** ISO week badge: "W40". */
export function formatWeekBadge(day: DateKey): string {
  return `W${isoWeekOf(day).week}`;
}

/** Long ISO week label: "Week 40". */
export function formatWeekLong(day: DateKey): string {
  return `Week ${isoWeekOf(day).week}`;
}

/** Accessible name of the grid region: "Week of Oct 5 – 11, 2026" or "Monday, October 5, 2026". */
export function formatGridRegionLabel(days: readonly DateKey[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "Planner";
  if (first === last) return formatDate(first, "full");
  return `Week of ${formatDateRange(first, last)}`;
}

/** Accessible name of a day column: "Monday, October 5 · 3 tasks, 3h 30m". */
export function formatDayGroupLabel(day: DateKey, taskCount: number, hours: number): string {
  const base = formatDate(day, "weekday");
  if (taskCount === 0) return `${base} · No tasks`;
  return `${base} · ${pluralize(taskCount, "task")}, ${formatDuration(hours)}`;
}

/** "Mon" style micro label in upper case for the day header. */
export function formatWeekdayMicro(day: DateKey): string {
  return formatWeekdayShort(day).toLocaleUpperCase();
}

/**
 * A title as shown to people: blank or whitespace-only titles (legacy data) read "Untitled task"
 * (or `fallback`) instead of rendering as nothing.
 */
export function displayTitle(title: string | null | undefined, fallback = "Untitled task"): string {
  const trimmed = (title ?? "").trim();
  return trimmed || fallback;
}

/**
 * How many calendar days after its start day a task ends: 0 for a task ending the same day
 * (including one ending exactly at midnight), 1 for 08:00 + 30h, etc.
 */
export function taskEndDayOffset(start: UtcIsoString, hours: number): number {
  // The last minute it occupies decides the day, so 23:00–00:00 still ends "today".
  const lastMinute = addMinutes(endInstant(start, hours), -1);
  return Math.max(0, diffCalendarDays(toDateKey(lastMinute), toDateKey(start)));
}

/** "+1d" / "+2d" marker for tasks that run into a later day ("" otherwise). */
export function formatEndDayMarker(start: UtcIsoString, hours: number): string {
  const days = taskEndDayOffset(start, hours);
  return days > 0 ? `+${days}d` : "";
}

/** Time range of a task, marking a later end day: "09:00 – 10:30", "08:00 – 14:00 +1d". */
export function formatTaskTimeRange(start: UtcIsoString, hours: number): string {
  const marker = formatEndDayMarker(start, hours);
  const range = formatTimeRange(start, hours);
  return marker ? `${range} ${marker}` : range;
}

/** "Tuesday 09:00 – 10:30", or "Wednesday 08:00 – Thursday 14:00" when it ends on a later day. */
function formatTaskSpan(start: UtcIsoString, hours: number): string {
  const day = formatWeekdayLong(toDateKey(start));
  if (taskEndDayOffset(start, hours) === 0) return `${day} ${formatTimeRange(start, hours)}`;
  const end = endInstant(start, hours);
  return `${day} ${formatTime(start)} – ${formatWeekdayLong(toDateKey(end))} ${formatTime(end)}`;
}

/** Accessible label for a task block: "Deep work, Tuesday 09:00 – 10:30, Work". */
export function formatTaskLabel(
  task: { title: string; start: UtcIsoString; duration: number },
  categoryName: string | undefined,
  organizationName?: string | null
): string {
  const parts = [displayTitle(task.title), formatTaskSpan(task.start, task.duration)];
  if (categoryName) parts.push(categoryName);
  // Org tasks in "my planner" say where they come from: "…, Work, Acme task".
  if (organizationName?.trim()) parts.push(`${organizationName.trim()} task`);
  return parts.join(", ");
}

/**
 * Live-region text after a move/resize/paste/duplicate: "Moved Deep work to Tuesday, 09:15 – 10:45."
 */
export function formatMoveAnnouncement(
  task: { title: string; start: UtcIsoString; duration: number },
  verb: "Moved" | "Resized" | "Pasted" | "Duplicated" = "Moved"
): string {
  const day = formatWeekdayLong(toDateKey(task.start));
  return `${verb} ${displayTitle(task.title, "task")} to ${day}, ${formatTaskTimeRange(task.start, task.duration)}.`;
}

/** The active zone's short offset for the grid corner: "UTC+2" (or "UTC"). */
export function formatGridCornerOffset(at: InstantInput = now()): string {
  return formatUtcOffset(at, "short");
}

/** Start of the next quarter-hour after `from` (default now), as an instant. */
export function nextQuarterHour(from: InstantInput = now()): UtcIsoString {
  const day = toDateKey(from);
  const minutes = minutesSinceStartOfDay(from);
  const next = Math.ceil((minutes + 0.001) / 15) * 15;
  return atMinutesOfDay(day, next);
}

/**
 * Default start for "New task" (N, FAB, sidebar button): the next quarter-hour today when today
 * is among `visibleDays` (or no days are given), else 09:00 on the first visible day.
 */
export function defaultNewTaskStart(visibleDays?: readonly DateKey[]): UtcIsoString {
  const today = todayKey();
  if (!visibleDays || visibleDays.length === 0 || visibleDays.includes(today)) {
    return nextQuarterHour();
  }
  return atMinutesOfDay(visibleDays[0]!, 9 * 60);
}

/** Wall-clock end "HH:mm" (24h, for <input type=time>) of a task. */
export function endTimeOfDay(start: UtcIsoString, hours: number): string {
  return splitInstant(endInstant(start, hours)).time;
}

/** "until 11:30" style end time of a task in the user's locale. */
export function formatEndTime(start: UtcIsoString, hours: number): string {
  return formatTime(endInstant(start, hours));
}

/** `start + minutes`, as an instant. Re-exported convenience for components. */
export function shiftMinutes(start: UtcIsoString, minutes: number): UtcIsoString {
  return addMinutes(start, minutes);
}

/** Planned-hours caption for a day header: "3.5h" (one decimal, trailing .0 trimmed). */
export function formatHoursCompact(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}h`;
}

/** Short live-region text for one keyboard step: "Tuesday, 09:15 – 10:45". */
export function formatSlotAnnouncement(task: { start: UtcIsoString; duration: number }): string {
  const day = formatWeekdayLong(toDateKey(task.start));
  if (taskEndDayOffset(task.start, task.duration) === 0) {
    return `${day}, ${formatTimeRange(task.start, task.duration)}`;
  }
  const end = endInstant(task.start, task.duration);
  return `${day}, ${formatTime(task.start)} – ${formatWeekdayLong(toDateKey(end))} ${formatTime(end)}`;
}

/**
 * Label of the edge cue while a dragged task is held at the grid's edge:
 * "Next week · Oct 12 – 18, 2026" / "Previous day · Sat, Oct 3" (single-day view).
 */
export function formatEdgeTargetLabel(days: readonly DateKey[], side: -1 | 1): string {
  const first = days[0];
  if (!first) return "";
  const direction = side > 0 ? "Next" : "Previous";
  if (days.length === 1) {
    return `${direction} day · ${formatDate(addDays(first, side), "weekdayShort")}`;
  }
  const monday = addDays(first, 7 * side);
  return `${direction} week · ${formatDateRange(monday, addDays(monday, 6))}`;
}
