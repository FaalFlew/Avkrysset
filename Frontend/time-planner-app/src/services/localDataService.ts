// src/services/localDataService.ts
// Guest-mode persistence in localStorage.

import type { Task, TaskTemplate, Category } from "@/types";
import { normalizeStoredInstant } from "@/lib/datetime";

const TASKS_STORAGE_KEY = "vue-time-planner-tasks";
const TEMPLATES_STORAGE_KEY = "vue-time-planner-templates";
const CATEGORIES_STORAGE_KEY = "vue-time-planner-categories";

/** Suffix of the keys where entries the app cannot read are kept (never deleted by the app). */
const UNREADABLE_SUFFIX = "-unreadable";

/** Guest tasks the app could not read (e.g. an unparseable start), preserved verbatim. */
export const UNREADABLE_TASKS_STORAGE_KEY = `${TASKS_STORAGE_KEY}${UNREADABLE_SUFFIX}`;

/**
 * Keep entries the app cannot use under `<key>-unreadable` instead of losing them: the task
 * store saves its (filtered) state back to `<key>` on the next change. Entries are appended once
 * (de-duplicated by their JSON), so repeated loads do not grow the backup.
 */
function preserveUnreadable(key: string, entries: unknown[]): void {
  if (entries.length === 0) return;
  const backupKey = `${key}${UNREADABLE_SUFFIX}`;
  try {
    const raw = localStorage.getItem(backupKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const existing: unknown[] = Array.isArray(parsed) ? parsed : [{ unparsedJson: raw }];
    const seen = new Set(existing.map((entry) => JSON.stringify(entry)));
    for (const entry of entries) {
      const id = JSON.stringify(entry);
      if (!seen.has(id)) {
        existing.push(entry);
        seen.add(id);
      }
    }
    localStorage.setItem(backupKey, JSON.stringify(existing));
  } catch (error) {
    console.error(`Could not back up unreadable guest data from "${key}":`, error);
  }
}

// A helper to get items from localStorage and parse them. A value that is not a JSON array is
// backed up (see preserveUnreadable) before the app starts over with an empty list.
function getItems<T>(key: string): T[] {
  const items = localStorage.getItem(key);
  if (!items) return [];
  try {
    const parsed: unknown = JSON.parse(items);
    if (Array.isArray(parsed)) return parsed as T[];
    console.error(`Guest data in "${key}" is not a list; keeping it under "${key}${UNREADABLE_SUFFIX}".`);
  } catch (error) {
    console.error(`Unreadable guest data in "${key}"; keeping it under "${key}${UNREADABLE_SUFFIX}".`, error);
  }
  preserveUnreadable(key, [{ unparsedJson: items }]);
  return [];
}

// A helper to save items to localStorage
function saveItems<T>(key: string, items: T[]): void {
  localStorage.setItem(key, JSON.stringify(items));
}

// Helper to remove an item from localStorage
function clearItems(key: string): void {
  localStorage.removeItem(key);
}

/**
 * Guest tasks with `start` normalized to canonical UTC. Current data is already canonical;
 * legacy entries saved as `"YYYY-MM-DD HH:mm:ss"` are local wall-clock time. Entries whose
 * start cannot be read are left out of the result (with a warning) but preserved verbatim under
 * {@link UNREADABLE_TASKS_STORAGE_KEY}, so the next save of the task list cannot lose them.
 * The normalized values are written back by the task store's persistence subscriber.
 */
function getTasks(): Task[] {
  const tasks: Task[] = [];
  const unreadable: unknown[] = [];
  for (const task of getItems<Task>(TASKS_STORAGE_KEY)) {
    const start = normalizeStoredInstant(task?.start);
    if (start === null) {
      console.warn(
        `Skipping a guest task with an unreadable start; it is kept under "${UNREADABLE_TASKS_STORAGE_KEY}":`,
        task
      );
      unreadable.push(task);
      continue;
    }
    tasks.push({ ...task, start });
  }
  preserveUnreadable(TASKS_STORAGE_KEY, unreadable);
  return tasks;
}

// --- Task Service ---
export const localTaskService = {
  getTasks,
  saveTasks: (tasks: Task[]): void => saveItems<Task>(TASKS_STORAGE_KEY, tasks),
  clearTasks: (): void => clearItems(TASKS_STORAGE_KEY),
};

// --- Template Service ---
export const localTemplateService = {
  getTemplates: (): TaskTemplate[] =>
    getItems<TaskTemplate>(TEMPLATES_STORAGE_KEY),
  saveTemplates: (templates: TaskTemplate[]): void =>
    saveItems<TaskTemplate>(TEMPLATES_STORAGE_KEY, templates),
  clearTemplates: (): void => clearItems(TEMPLATES_STORAGE_KEY),
};

// --- Category Service ---
export const localCategoryService = {
  getCategories: (): Category[] => getItems<Category>(CATEGORIES_STORAGE_KEY),
  saveCategories: (categories: Category[]): void =>
    saveItems<Category>(CATEGORIES_STORAGE_KEY, categories),
  clearCategories: (): void => clearItems(CATEGORIES_STORAGE_KEY),
};
