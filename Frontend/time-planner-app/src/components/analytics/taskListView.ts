// src/components/analytics/taskListView.ts — display helpers shared by the task list's table
// (wide cards, paper) and its card list (phones, narrow cards).

import { formatCount, formatDuration, pluralize } from "@/lib/format";
import { taskEndDayOffset } from "@/lib/plannerFormat";
import type { TaskListDay, TaskListRow } from "@/lib/taskList";

/** Below this card width (CSS px of the card's content box) the list renders as cards. */
export const CARD_LAYOUT_MAX_WIDTH = 760;

/** Printing renders at most this many rows (same cap and note as the PDF). */
export const PRINT_ROW_CAP = 5000;

export type TaskListLayout = "table" | "cards";

/**
 * Table or cards: paper always gets the table; on screen the card's measured width decides, and
 * before it is measured the phone breakpoint does (so phones never flash a table).
 */
export function taskListLayout(opts: {
  printing: boolean;
  cardWidth: number | null;
  isMobile: boolean;
}): TaskListLayout {
  if (opts.printing) return "table";
  if (opts.cardWidth !== null && opts.cardWidth > 0) {
    return opts.cardWidth < CARD_LAYOUT_MAX_WIDTH ? "cards" : "table";
  }
  return opts.isMobile ? "cards" : "table";
}

/** "+1d" and how a screen reader says it ("ends the next day"); null when it ends the same day. */
export function endMarker(row: Pick<TaskListRow, "start" | "hours">): { text: string; spoken: string } | null {
  const days = taskEndDayOffset(row.start, row.hours);
  if (days <= 0) return null;
  return { text: `+${days}d`, spoken: days === 1 ? "ends the next day" : `ends ${days} days later` };
}

/** "3 tasks · 4h 30m" */
export function daySummary(day: Pick<TaskListDay, "count" | "hours">): string {
  return `${pluralize(day.count, "task")} · ${formatDuration(day.hours)}`;
}

/** "12 of 5,003 tasks" (filtered) or "5,003 tasks". */
export function totalCountText(count: number, allCount: number, filtered: boolean): string {
  return filtered ? `${formatCount(count)} of ${pluralize(allCount, "task")}` : pluralize(count, "task");
}

/** A click on a row opens its task, unless the user was selecting text (to copy a title). */
export function isRowActivation(event: MouseEvent): boolean {
  const selection = typeof window !== "undefined" ? window.getSelection?.()?.toString() : "";
  const onButton = (event.target as HTMLElement | null)?.closest?.("button");
  return !selection || !!onButton;
}
