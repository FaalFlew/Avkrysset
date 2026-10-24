// src/lib/taskAccess.ts — what the signed-in user may do with a task (D7 + Q1 + Q3).
//
// "My planner" holds personal tasks and organization tasks assigned to me. The server says what I
// may do with each task (`capabilities`); the UI mirrors it and the server stays the authority:
// - Personal tasks (and guest tasks, which have no capabilities): editable and deletable.
// - Org tasks an Owner/Admin assigned to a member: read-only for that member (no drag, resize,
//   keyboard move, delete; the editor opens read-only).
// - Org tasks a member created for themselves, and every org task for Owner/Admin: editable;
//   saves go to /organizations/{orgId}/tasks/{id}.
// - Overlaps (Q3): moving a PERSONAL task onto any other task (incl. assigned org tasks) is
//   blocked; org tasks are never checked (admins assign without seeing personal calendars), so
//   they may overlap and the planner draws them in side-by-side lanes.

import type { Task, TaskCapabilities } from "@/types";
import { overlaps } from "@/lib/datetime";

const PERSONAL: TaskCapabilities = { canEdit: true, canDelete: true, canReassign: false };
const READ_ONLY: TaskCapabilities = { canEdit: false, canDelete: false, canReassign: false };

/** The task belongs to an organization. */
export function isOrgTask(task: Pick<Task, "organizationId">): boolean {
  return typeof task.organizationId === "string" && task.organizationId.length > 0;
}

/**
 * Effective capabilities: the server's when present; personal defaults for personal/guest tasks;
 * read-only for an org task without capabilities (never guess permissions up).
 */
export function taskCapabilities(task: Pick<Task, "organizationId" | "capabilities">): TaskCapabilities {
  if (task.capabilities) return task.capabilities;
  return isOrgTask(task) ? READ_ONLY : PERSONAL;
}

export const canEditTask = (task: Pick<Task, "organizationId" | "capabilities">) => taskCapabilities(task).canEdit;
export const canDeleteTask = (task: Pick<Task, "organizationId" | "capabilities">) =>
  taskCapabilities(task).canDelete;

/** Read-only for me (an org task assigned to me by an admin). */
export const isReadOnlyTask = (task: Pick<Task, "organizationId" | "capabilities">) => !canEditTask(task);

/** How the editor opens a task. */
export function editorModeFor(task: Pick<Task, "organizationId" | "capabilities"> | null): "create" | "edit" | "readonly" {
  if (!task) return "create";
  return canEditTask(task) ? "edit" : "readonly";
}

/** The organization's name for display ("your organization" when the server sent none). */
export function organizationLabel(task: Pick<Task, "organizationName">): string {
  return task.organizationName?.trim() || "your organization";
}

/** "This task is managed in Acme." — said when a read-only task is moved or deleted. */
export function managedMessage(task: Pick<Task, "organizationName">): string {
  return `This task is managed in ${organizationLabel(task)}.`;
}

/** One or two letters for an org badge: "Acme" → "A", "Blue Sky Labs" → "BS". */
export function orgMonogram(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "•";
  const letters = words.length === 1 ? Array.from(words[0]!).slice(0, 1) : words.slice(0, 2).map((w) => Array.from(w)[0]!);
  return letters.join("").toLocaleUpperCase();
}

/** Same wording as the server's 409 for personal-vs-personal overlaps. */
export const OVERLAP_MESSAGE = "This time slot overlaps with an existing task.";

/**
 * Why a move was refused by the client pre-check, in the server's words: an assigned org task
 * names its organization ("This time overlaps a task assigned to you in Acme."), anything else
 * gets the generic overlap message.
 */
export function overlapMessage(other: Pick<Task, "organizationId" | "organizationName"> | null | undefined): string {
  if (other && isOrgTask(other)) return `This time overlaps a task assigned to you in ${organizationLabel(other)}.`;
  return OVERLAP_MESSAGE;
}

/** How the editor describes an org task's origin and assignees, from the viewer's side (D7). */
export interface OrgAttribution {
  /** "Assigned by Ana · Acme" / "Created by you · Acme" / "Acme". */
  line: string;
  /** "for you", "for you and 2 others", "for Kari, Ola"; null when it adds nothing. */
  forWhom: string | null;
  /** Assignee names for a list, "You" first when I'm among them. */
  people: string[];
}

/**
 * Attribution of an org task for the user `me` (their user id; null when unknown, e.g. guests).
 * - The creator reads "you" when it's me; read-only tasks say "Assigned by", others "Created by".
 * - "for …" is left out for my own task assigned only to me (it would just repeat "you").
 */
export function orgAttribution(
  task: Pick<Task, "organizationName" | "createdBy" | "assignees">,
  me: string | null,
  readOnly: boolean
): OrgAttribution {
  const org = organizationLabel(task);
  const isMe = (userId: string | undefined) => !!me && !!userId && userId.toLowerCase() === me.toLowerCase();
  const creatorIsMe = isMe(task.createdBy?.userId);
  const by = creatorIsMe ? "you" : task.createdBy?.displayName?.trim();
  const line = by ? `${readOnly ? "Assigned by" : "Created by"} ${by} · ${org}` : org;

  const assignees = task.assignees ?? [];
  const meAssigned = assignees.some((a) => isMe(a.userId));
  const otherNames = assignees.filter((a) => !isMe(a.userId)).map((a) => a.displayName || a.email).filter(Boolean);
  const people = meAssigned ? ["You", ...otherNames] : otherNames;

  let forWhom: string | null = null;
  if (meAssigned) {
    const n = otherNames.length;
    if (n > 0) forWhom = `for you and ${n} other${n === 1 ? "" : "s"}`;
    else if (!creatorIsMe) forWhom = "for you";
  } else if (otherNames.length > 0) {
    forWhom = `for ${otherNames.join(", ")}`;
  }
  return { line, forWhom, people };
}

/**
 * Whether moving/resizing `task` must not overlap other tasks (client pre-check, same rule as
 * the server for personal endpoints): personal tasks yes, org tasks no (Q3).
 */
export function checksOverlap(task: Pick<Task, "organizationId">): boolean {
  return !isOrgTask(task);
}

/**
 * For each task, the other tasks it overlaps (half-open, same rule as the server). Used to mark
 * overlapping rows in Today (org tasks may overlap personal ones, Q3).
 */
export function overlapIndex<T extends Pick<Task, "id" | "start" | "duration">>(tasks: readonly T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      const a = tasks[i]!;
      const b = tasks[j]!;
      if (!overlaps(a.start, a.duration, b.start, b.duration)) continue;
      result.set(a.id, [...(result.get(a.id) ?? []), b]);
      result.set(b.id, [...(result.get(b.id) ?? []), a]);
    }
  }
  return result;
}
