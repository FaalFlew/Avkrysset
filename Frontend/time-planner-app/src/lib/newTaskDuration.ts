// src/lib/newTaskDuration.ts — the default length of a new task (backlog item 2).
//
// Rule (agreed with the owner): min(1 hour, the free time from the chosen start until the next
// task that starts at or after it), rounded DOWN to the 15-minute grid, at least 15 minutes.
// Every loaded task counts — personal and assigned org tasks, also on a later day — because a new
// personal task may not overlap any of them. Free time is elapsed time between two instants, so
// DST days need no special casing. Drag-to-create keeps the dragged length (callers pass it), and
// the save still runs the normal overlap check.

import type { Task } from "@/types";
import { diffMinutes, type UtcIsoString } from "@/lib/datetime";
import { displayTitle } from "@/lib/plannerFormat";

/** Default length of a new task when nothing follows it soon. */
export const DEFAULT_NEW_TASK_MINUTES = 60;
/** The planner's grid step: suggestions are multiples of it. */
export const NEW_TASK_STEP_MINUTES = 15;

export interface DurationSuggestion {
  /** Suggested duration in minutes: a multiple of 15 between 15 and 60. */
  minutes: number;
  /** Elapsed minutes from the start until the next task starts; null when no task follows. */
  freeMinutes: number | null;
  /** Title of that next task (null when none). */
  nextTitle: string | null;
}

/** The default duration for a task starting at `start`, given the tasks already planned. */
export function suggestNewTaskDuration(
  start: UtcIsoString,
  tasks: readonly Pick<Task, "start" | "title">[]
): DurationSuggestion {
  let next: Pick<Task, "start" | "title"> | null = null;
  let free = Number.POSITIVE_INFINITY;
  for (const task of tasks) {
    const minutes = diffMinutes(task.start, start);
    // Tasks that started earlier are not "next" (a start inside one is the overlap check's job).
    if (minutes < 0 || minutes >= free) continue;
    free = minutes;
    next = task;
  }
  if (!next) return { minutes: DEFAULT_NEW_TASK_MINUTES, freeMinutes: null, nextTitle: null };
  const fitted = Math.floor(free / NEW_TASK_STEP_MINUTES) * NEW_TASK_STEP_MINUTES;
  return {
    minutes: Math.min(DEFAULT_NEW_TASK_MINUTES, Math.max(NEW_TASK_STEP_MINUTES, fitted)),
    freeMinutes: free,
    nextTitle: next.title,
  };
}

/**
 * The editor's note when even the shortest task doesn't fit before the next one:
 * "Only 10 min free before “Standup”." ("" when it fits). Saving still runs the overlap check.
 */
export function freeTimeNote(suggestion: DurationSuggestion): string {
  const free = suggestion.freeMinutes;
  if (free === null || free >= NEW_TASK_STEP_MINUTES) return "";
  const title = displayTitle(suggestion.nextTitle);
  const minutes = Math.floor(free);
  return minutes <= 0 ? `“${title}” starts at this time.` : `Only ${minutes} min free before “${title}”.`;
}
