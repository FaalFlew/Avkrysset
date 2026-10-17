// src/lib/taskList.ts — the analytics task list (docs/plans/analytics-task-list.md): every task
// starting in the selected range, shared by the page, print and the guest task CSV.
//
// Data rules (same as the server's report rows):
// - A task belongs to the range, and to a day, by its START instant (day = local date, toDateKey).
// - Category = the analytics grouping: personal tasks by their category; organization tasks under
//   the ORGANIZATION (category id = org id), named and colored like the analytics response's
//   category entry for that id (never from a palette copy here).
// - Template: the template's title; none → null ("—" on the page, empty in the CSV); a template
//   that no longer exists → "Deleted template". Organization tasks count as "without template",
//   like the analytics breakdown.
// - Created by: "You" for my own tasks (always for personal and guest tasks), else the creator's
//   display name (the API falls back to the email).
// - Order: start ascending, then title, then id — ordinal comparison (plain `<`, like .NET Ordinal).
// Built only on src/lib/datetime.ts primitives (architecture rule).

import type { Task, TaskTemplate } from "@/types";
import { endInstant, toDateKey, toEpochMs, type DateKey, type UtcIsoString } from "@/lib/datetime";
import { displayTitle } from "@/lib/plannerFormat";
import { compareByHoursThenName, ordinalCompare } from "@/lib/analyticsOrder";
import { isOrgTask } from "@/lib/taskAccess";

/** Name of a template that no longer exists (same wording as the analytics breakdown). */
export const DELETED_TEMPLATE = "Deleted template";
/** Creator label for the signed-in user's (and a guest's) own tasks. */
export const CREATED_BY_YOU = "You";
/** How many rows "Show more" adds (and the first page shows). */
export const TASK_LIST_PAGE_SIZE = 100;

/** A category as the analytics breakdown groups it. `color` is a hex, or null when unknown. */
export interface TaskListCategory {
  id: string;
  name: string;
  color: string | null;
}

export interface TaskListRow {
  id: string;
  /** The task itself (opened in the editor). */
  task: Task;
  start: UtcIsoString;
  end: UtcIsoString;
  hours: number;
  /** Local calendar date of the start (the day group). */
  dateKey: DateKey;
  /** The title as stored (CSV, ordering). */
  title: string;
  /** The title as shown ("Untitled task" for blank titles; also what search matches). */
  label: string;
  category: TaskListCategory;
  /** Template title; null when the task has none. */
  templateTitle: string | null;
  templateDeleted: boolean;
  organizationName: string | null;
  /** "You", or the creator's display name. */
  createdBy: string;
  createdByMe: boolean;
  /** Assignee display names (org tasks), in the server's order. */
  assigneeNames: string[];
}

export interface TaskListContext {
  /** The analytics categories of the range (snapshot.categories): name and color by id. */
  categories: readonly TaskListCategory[];
  /** My categories (store), the fallback for categories the analytics data doesn't list. */
  categoryById?: (id: string) => { name: string; color: string } | undefined;
  /** My templates (store). */
  templates: readonly Pick<TaskTemplate, "id" | "title">[];
  /** The signed-in user's id; null for guests (or while unknown). */
  currentUserId: string | null;
}

const sameId = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The analytics category a task counts under (see the module note). */
export function taskListCategory(task: Task, ctx: Pick<TaskListContext, "categories" | "categoryById">): TaskListCategory {
  const analytics = (id: string) => ctx.categories.find((c) => c.id === id);
  if (isOrgTask(task)) {
    const id = task.organizationId!;
    const entry = analytics(id);
    return {
      id,
      name: entry?.name || task.organizationName?.trim() || "Organization",
      color: entry?.color ?? null,
    };
  }
  const entry = analytics(task.categoryId);
  const own = ctx.categoryById?.(task.categoryId);
  return {
    id: task.categoryId,
    name: entry?.name || own?.name || task.categoryName || "Unknown category",
    color: entry?.color ?? own?.color ?? (task.categoryColor || null),
  };
}

/** One task as a list row. */
export function toTaskListRow(task: Task, ctx: TaskListContext): TaskListRow {
  const hours = Number(task.duration) || 0;
  const org = isOrgTask(task);
  const templateId = org ? null : task.templateId || null;
  const template = templateId ? ctx.templates.find((t) => t.id === templateId) : undefined;
  // Personal (and guest) tasks are always mine; org tasks say who created them.
  const createdByMe = !org || sameId(task.createdBy?.userId, ctx.currentUserId);
  return {
    id: task.id,
    task,
    start: task.start,
    end: endInstant(task.start, hours),
    hours,
    dateKey: toDateKey(task.start),
    title: task.title ?? "",
    label: displayTitle(task.title),
    category: taskListCategory(task, ctx),
    templateTitle: templateId ? (template ? template.title : DELETED_TEMPLATE) : null,
    templateDeleted: !!templateId && !template,
    organizationName: org ? task.organizationName?.trim() || "Organization" : null,
    createdBy: createdByMe ? CREATED_BY_YOU : task.createdBy?.displayName?.trim() || "—",
    createdByMe,
    assigneeNames: (task.assignees ?? []).map((a) => a.displayName || a.email).filter(Boolean),
  };
}

/** Start ascending, then title, then id (both ordinal) — the order shared with the server. */
export function compareTaskListRows(
  a: Pick<TaskListRow, "start" | "title" | "id">,
  b: Pick<TaskListRow, "start" | "title" | "id">
): number {
  const ta = toEpochMs(a.start);
  const tb = toEpochMs(b.start);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return ordinalCompare(a.title, b.title) || ordinalCompare(a.id, b.id);
}

/** The rows of `tasks`, in list order. */
export function buildTaskListRows(tasks: readonly Task[], ctx: TaskListContext): TaskListRow[] {
  return tasks.map((task) => toTaskListRow(task, ctx)).sort(compareTaskListRows);
}

export interface TaskListTotals {
  count: number;
  hours: number;
}

export function taskListTotals(rows: readonly Pick<TaskListRow, "hours">[]): TaskListTotals {
  return { count: rows.length, hours: rows.reduce((sum, row) => sum + row.hours, 0) };
}

export interface TaskListFilter {
  /** Title search (case-insensitive, trimmed); empty = no search. */
  query: string;
  /** Category id (analytics grouping); null = every category. */
  categoryId: string | null;
}

export const NO_FILTER: TaskListFilter = { query: "", categoryId: null };

export function isFiltered(filter: TaskListFilter): boolean {
  return filter.query.trim() !== "" || filter.categoryId !== null;
}

/** Rows matching the search and the category (order kept). */
export function filterTaskListRows(rows: readonly TaskListRow[], filter: TaskListFilter): TaskListRow[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (filter.categoryId === null || row.category.id === filter.categoryId) &&
      (query === "" || row.label.toLocaleLowerCase().includes(query))
  );
}

/** A category of the list with its totals (for the filter chips). */
export interface TaskListCategoryCount extends TaskListCategory, TaskListTotals {}

/** The categories in `rows`, ordered like the analytics breakdown (hours DESC, name, id). */
export function taskListCategories(rows: readonly TaskListRow[]): TaskListCategoryCount[] {
  const byId = new Map<string, TaskListCategoryCount>();
  for (const row of rows) {
    const entry = byId.get(row.category.id);
    if (entry) {
      entry.count += 1;
      entry.hours += row.hours;
    } else {
      byId.set(row.category.id, { ...row.category, count: 1, hours: row.hours });
    }
  }
  return [...byId.values()].sort(compareByHoursThenName);
}

export interface TaskListDay extends TaskListTotals {
  dateKey: DateKey;
  /** Every row of the day (subtotals cover all of them). */
  rows: TaskListRow[];
}

/** Consecutive rows grouped by their local start date (rows must be in list order). */
export function groupTaskListRows(rows: readonly TaskListRow[]): TaskListDay[] {
  const days: TaskListDay[] = [];
  for (const row of rows) {
    let day = days[days.length - 1];
    if (!day || day.dateKey !== row.dateKey) {
      day = { dateKey: row.dateKey, rows: [], count: 0, hours: 0 };
      days.push(day);
    }
    day.rows.push(row);
    day.count += 1;
    day.hours += row.hours;
  }
  return days;
}

export interface TaskListPageDay extends TaskListDay {
  /** The rows of this day that are on the current page. */
  visibleRows: TaskListRow[];
}

/**
 * The first `limit` rows, still grouped by day; a day cut by the page keeps its full subtotal.
 * `limit = Infinity` shows everything (print).
 */
export function pageTaskListDays(days: readonly TaskListDay[], limit: number): TaskListPageDay[] {
  const page: TaskListPageDay[] = [];
  let left = limit;
  for (const day of days) {
    if (left <= 0) break;
    const visibleRows = day.rows.length <= left ? day.rows : day.rows.slice(0, left);
    left -= visibleRows.length;
    page.push({ ...day, visibleRows });
  }
  return page;
}
