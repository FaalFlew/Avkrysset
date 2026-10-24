// src/lib/taskClipboard.ts — pure rules of copying, pasting and duplicating tasks (backlog item 3).
//
// - A copy is always a PERSONAL task. From a task I may edit it keeps the title, duration and —
//   when they are mine — the category and template. From a read-only org task (assigned to me by
//   an admin) it keeps only the title and duration: the creator's category and template are not
//   mine (the server only accepts my own categories), so the copy gets my last-used category, or
//   "Other". Org tasks I created myself are copied as personal tasks too (the planner has no
//   "which organization?" step).
// - Paste target (desktop Ctrl/⌘+V): the 15-minute slot under the mouse pointer when it is over
//   the grid; otherwise right after the focused task (start = its end); otherwise the copied
//   task's time of day on the selected day.
// - Duplicates keep the wall-clock time (09:00 stays 09:00 across a DST change).

import type { Category, Task, TaskTemplate } from "@/types";
import { canEditTask } from "@/lib/taskAccess";
import {
  addDays,
  atMinutesOfDay,
  endInstant,
  minutesSinceStartOfDay,
  moveToDate,
  toDateKey,
  type DateKey,
  type UtcIsoString,
} from "@/lib/datetime";

/** A task to create (same shape as taskStore's NewTaskData). */
export type NewTaskFromCopy = Omit<Task, "id" | "categoryName" | "categoryColor">;

export interface CopiedTask {
  /** The task it was copied from. */
  sourceId: string;
  title: string;
  /** Elapsed hours. */
  duration: number;
  /** Category to keep; null = the user's last-used or default category, resolved at paste time. */
  categoryId: string | null;
  /** Template to keep (null = none). */
  templateId: string | null;
  /** Wall-clock minutes after midnight of the original start (paste on the selected day). */
  minutesOfDay: number;
}

/** What `task` becomes on the clipboard, given the user's own categories and templates. */
export function copyOf(
  task: Task,
  mine: { categories: readonly Pick<Category, "id">[]; templates: readonly Pick<TaskTemplate, "id">[] }
): CopiedTask {
  const editable = canEditTask(task);
  const categoryId = editable && mine.categories.some((c) => c.id === task.categoryId) ? task.categoryId : null;
  const templateId =
    editable && task.templateId && mine.templates.some((t) => t.id === task.templateId) ? task.templateId : null;
  return {
    sourceId: task.id,
    title: task.title,
    duration: task.duration,
    categoryId,
    templateId,
    minutesOfDay: minutesSinceStartOfDay(task.start),
  };
}

/** The category of a copy whose own category is unknown: last used, else "Other", else the first. */
export function fallbackCategoryId(
  categories: readonly Pick<Category, "id" | "name">[],
  lastCategoryId: string | null
): string | null {
  if (lastCategoryId && categories.some((c) => c.id === lastCategoryId)) return lastCategoryId;
  return categories.find((c) => c.name === "Other")?.id ?? categories[0]?.id ?? null;
}

/** The new (personal) task a paste/duplicate creates at `start`; null when there is no category. */
export function newTaskFromCopy(
  copied: CopiedTask,
  start: UtcIsoString,
  context: { categories: readonly Pick<Category, "id" | "name">[]; lastCategoryId: string | null }
): NewTaskFromCopy | null {
  const keep = copied.categoryId && context.categories.some((c) => c.id === copied.categoryId);
  const categoryId = keep ? copied.categoryId : fallbackCategoryId(context.categories, context.lastCategoryId);
  if (!categoryId) return null;
  const task: NewTaskFromCopy = { title: copied.title, start, duration: copied.duration, categoryId };
  if (copied.templateId) task.templateId = copied.templateId;
  return task;
}

export type PasteTargetKind = "pointer" | "afterFocused" | "selectedDay";

export interface PasteTargetInput {
  /** The 15-minute slot under the mouse pointer, when the pointer is over the grid. */
  pointerSlot: { day: DateKey; minutes: number } | null;
  /** The task that has keyboard focus (its displayed position). */
  focused: Pick<Task, "start" | "duration"> | null;
  /** The planner's selected day. */
  selectedDay: DateKey;
  /** Wall-clock minutes of the copied task's start. */
  minutesOfDay: number;
}

/** Where Ctrl/⌘+V puts the copy (see the header). */
export function resolvePasteStart(input: PasteTargetInput): { start: UtcIsoString; kind: PasteTargetKind } {
  if (input.pointerSlot) {
    return { start: atMinutesOfDay(input.pointerSlot.day, input.pointerSlot.minutes), kind: "pointer" };
  }
  if (input.focused) {
    return { start: endInstant(input.focused.start, input.focused.duration), kind: "afterFocused" };
  }
  return { start: atMinutesOfDay(input.selectedDay, input.minutesOfDay), kind: "selectedDay" };
}

/** Start of a duplicate `days` calendar days later, at the same wall-clock time (DST-safe). */
export function duplicateStart(start: UtcIsoString, days: number): UtcIsoString {
  return moveToDate(start, addDays(toDateKey(start), days));
}
