// src/stores/taskStore.ts — tasks, templates and categories for guests (localStorage) and
// signed-in users (API). All instants are canonical UTC strings; date math lives in
// src/lib/datetime.ts.

import { defineStore } from "pinia";
import { v4 as uuidv4 } from "uuid";
import { useUIStore } from "./uiStore";
import type { Task, TaskTemplate, Category, MigrationData } from "@/types";
import type { ToastAction } from "@/components/ui/types";
import { apiDataService } from "@/services/apiDataService";
import { sessionBound, useAuthStore } from "./authStore";
import {
  localTaskService,
  localTemplateService,
  localCategoryService,
} from "@/services/localDataService";
import {
  dayRange,
  formatDate,
  isInRange,
  normalizeStoredInstant,
  overlaps,
  toApiInstant,
  toDateKey,
  todayKey,
  tryParseApiInstant,
  type DateKey,
  type InstantRange,
} from "@/lib/datetime";
import { OTHER_COLOR } from "@/lib/categoryPalette";
import {
  apiErrorMessage,
  isBadRequest,
  isConflict,
  isForbidden,
  isSessionChangedError,
  NETWORK_ERROR_MESSAGE,
} from "@/lib/apiErrors";
import {
  canDeleteTask,
  canEditTask,
  isOrgTask,
  managedMessage,
  OVERLAP_MESSAGE,
  overlapMessage,
  taskCapabilities,
} from "@/lib/taskAccess";

/** Same rule as the server: half-open intervals, so touching tasks do not overlap. */
const isOverlapping = (
  taskA: Pick<Task, "start" | "duration">,
  taskB: Pick<Task, "start" | "duration">
): boolean => overlaps(taskA.start, taskA.duration, taskB.start, taskB.duration);

/** Canonical UTC form of a task start (string instants follow API semantics), or null. */
const canonicalStart = (start: string): string | null => {
  const ms = tryParseApiInstant(start);
  return ms === null ? null : toApiInstant(ms);
};

// Error copy lives in src/lib/apiErrors.ts (re-exported here for existing importers).
export { apiErrorMessage, NETWORK_ERROR_MESSAGE };
/** Same wording as the server's 409 (CreateTask/UpdateTask), so both paths read alike. */
export { OVERLAP_MESSAGE };
export const WEEK_ERROR_MESSAGE =
  "Couldn't load this week's tasks. Check your connection — what's on screen may be out of date.";
export const INIT_ERROR_MESSAGE = "Couldn't load your categories and templates.";
export const TODAY_ERROR_MESSAGE = "Couldn't load today's plan.";

/** `updateTask` options. A boolean is still accepted and means `{ silent }` (legacy signature). */
export interface UpdateTaskOptions {
  /** No toasts at all, not even errors. */
  silent?: boolean;
  /** No success toast (task updates never show one anymore; kept for callers that pass it). */
  silentSuccess?: boolean;
  /**
   * Action on the error toast when the server rejects the change as invalid (HTTP 400, e.g. a
   * duration it no longer accepts) — e.g. "Edit" to open the task in the editor.
   */
  errorAction?: ToastAction;
}

export interface AddTaskOptions {
  /** Suppress error toasts. */
  silent?: boolean;
}

export type NewTaskData = Omit<Task, "id" | "categoryName" | "categoryColor">;

/**
 * Keys of the error toasts of task actions (uiStore ToastOptions.key): when a retry of the same
 * action succeeds, its stale error toast is dismissed — and only that one.
 */
export const TOAST_KEYS = {
  addTask: "task:add",
  updateTask: (id: string) => `task:update:${id}`,
  deleteTask: (id: string) => `task:delete:${id}`,
} as const;

// Request bookkeeping (not reactive state).
/** The signed-in initialization in flight, per session (a new login never joins an old one). */
let initRequest: { epoch: number; promise: Promise<void> } | null = null;
let weekRequestSeq = 0;
let todayRequestSeq = 0;
let lastWeekRange: InstantRange | null = null;
/** Successful task mutations so far; a week response that started before one is stale. */
let taskMutations = 0;

export const useTaskStore = defineStore("tasks", {
  state: () => ({
    tasks: [] as Task[],
    templates: [] as TaskTemplate[],
    categories: [] as Category[],
    /** Tasks of `todayTasksDay` (signed-in users; guests derive Today from `tasks`). */
    todayTasks: [] as Task[],
    todayTasksDay: null as DateKey | null,

    /** Loading flags, one per request kind (no cross-talk between views). */
    isInitializing: false,
    isLoadingWeek: false,
    isLoadingToday: false,
    /** Error copy per request kind, `null` when the last attempt succeeded. */
    initError: null as string | null,
    weekError: null as string | null,
    todayError: null as string | null,

    /** Whether guest data has been read from localStorage into the state. */
    guestDataLoaded: false,
    /**
     * Session epoch (authStore.sessionEpoch) in which guest data was loaded. Guest data is only
     * saved while it matches: right after a logout the state still holds account data until
     * loadGuestData() runs, and that must never reach guest storage.
     */
    guestSessionEpoch: null as number | null,
  }),

  getters: {
    getCategoryById: (state) => (id: string) =>
      state.categories.find((c) => c.id === id),
    getTaskById: (state) => (id: string) =>
      state.tasks.find((t) => t.id === id) ?? state.todayTasks.find((t) => t.id === id),
    otherCategory: (state) => state.categories.find((c) => c.name === "Other"),
    /** Any request in flight (legacy aggregate; prefer the specific flags). */
    isLoading: (state) => state.isInitializing || state.isLoadingWeek || state.isLoadingToday,
  },

  actions: {
    /**
     * Load categories and templates (signed in) or all guest data (guest).
     * Concurrent calls share one request. Failures set `initError` (shown as a banner with Retry).
     */
    async initializeData(): Promise<void> {
      const authStore = useAuthStore();
      if (!authStore.isAuthenticated) {
        this.loadGuestData();
        this.initError = null;
        return;
      }
      if (initRequest && initRequest.epoch === authStore.sessionEpoch) return initRequest.promise;

      const request = { epoch: authStore.sessionEpoch, promise: Promise.resolve() };
      initRequest = request;
      request.promise = (async () => {
        this.isInitializing = true;
        this.initError = null;
        try {
          const [categories, templates] = await sessionBound(() =>
            Promise.all([apiDataService.getCategories(), apiDataService.getTaskTemplates()])
          );
          this.categories = categories;
          this.templates = templates;
          // Coming from guest mode: drop the guest tasks; the week is fetched by date range.
          if (this.guestDataLoaded) {
            this.tasks = [];
            this.todayTasks = [];
            this.todayTasksDay = null;
          }
          this.guestDataLoaded = false;
        } catch (error) {
          if (isSessionChangedError(error)) return; // logged out meanwhile: nothing to show
          console.error("Failed to initialize data:", error);
          this.initError = INIT_ERROR_MESSAGE;
        } finally {
          if (initRequest === request) {
            this.isInitializing = false;
            initRequest = null;
          }
        }
      })();
      return request.promise;
    },

    /** Guest mode: read categories, templates and tasks from localStorage (synchronous). */
    loadGuestData() {
      this.categories = localCategoryService.getCategories();
      this.templates = localTemplateService.getTemplates();
      this.tasks = localTaskService.getTasks();
      this.todayTasks = [];
      this.todayTasksDay = null;
      this.weekError = null;
      this.todayError = null;

      // Ensure the default "Other" category exists for guests
      if (!this.categories.find((c) => c.name === "Other")) {
        this.categories.unshift({ id: uuidv4(), name: "Other", color: OTHER_COLOR });
      }
      this.guestDataLoaded = true;
      this.guestSessionEpoch = useAuthStore().sessionEpoch;
    },

    /** Authenticated mode: load the tasks starting in `[range.start, range.end)`. */
    async fetchTasksForRange(range: InstantRange) {
      const authStore = useAuthStore();
      if (!authStore.isAuthenticated) return; // Only for logged-in users

      lastWeekRange = range;
      const seq = ++weekRequestSeq;
      const mutationsAtStart = taskMutations;
      this.isLoadingWeek = true;
      this.weekError = null;
      try {
        const tasks = await sessionBound(() => apiDataService.getTasks(range));
        if (seq !== weekRequestSeq) return; // a newer week was requested meanwhile
        if (taskMutations !== mutationsAtStart) {
          // A task was added/moved/deleted while this request was in flight (e.g. dropped into
          // this week mid-load): the response may predate it. Keep the optimistic state and ask
          // again instead of overwriting it.
          void this.fetchTasksForRange(range);
          return;
        }
        this.tasks = tasks;
      } catch (error) {
        if (seq !== weekRequestSeq || isSessionChangedError(error)) return;
        console.error("Failed to fetch tasks:", error);
        this.weekError = WEEK_ERROR_MESSAGE;
      } finally {
        if (seq === weekRequestSeq) this.isLoadingWeek = false;
      }
    },

    /** Re-run the last week fetch (error banner "Retry"). */
    async retryWeek() {
      if (this.initError) await this.initializeData();
      if (lastWeekRange) await this.fetchTasksForRange(lastWeekRange);
    },

    /**
     * After a 409 the server knows a task we don't (e.g. added on another device): reload the
     * visible week and Today so the conflicting task appears where the user tried to go.
     */
    refreshAfterConflict() {
      if (!useAuthStore().isAuthenticated) return;
      if (lastWeekRange) void this.fetchTasksForRange(lastWeekRange);
      if (this.todayTasksDay) void this.fetchTodayTasks(this.todayTasksDay);
    },

    /**
     * Reload after the server refused a change it knows more about: 409 (a task we don't have)
     * or 403 (my permissions changed, e.g. I was removed from the organization or an admin made
     * the task read-only) — the fresh capabilities stop the UI from offering the action again.
     */
    refreshAfterRejection(error: unknown) {
      if (isConflict(error) || isForbidden(error)) this.refreshAfterConflict();
    },

    // --- Guest → account migration ---
    getLocalDataForMigration(): MigrationData {
      // Called during registration. The default "Other" category is not migrated.
      const categories = localCategoryService.getCategories();
      const templates = localTemplateService.getTemplates();
      const tasks = localTaskService.getTasks();

      const mapCategory = (c: Category) => ({ id: c.id, name: c.name, color: c.color });
      const mapTemplate = (t: TaskTemplate) => ({
        id: t.id,
        title: t.title,
        duration: t.duration,
        categoryId: t.categoryId,
      });
      // The server parses `start` as UTC, so it must be canonical UTC (legacy guest values were
      // local wall-clock strings; localTaskService already normalizes, this is belt and braces).
      const mapTask = (t: Task) => {
        const start = normalizeStoredInstant(t.start);
        return start === null
          ? null
          : {
              title: t.title,
              start,
              duration: t.duration,
              categoryId: t.categoryId,
              templateId: t.templateId,
            };
      };

      return {
        categories: categories.filter((c) => c.name !== "Other").map(mapCategory),
        templates: templates.map(mapTemplate),
        tasks: tasks
          .map(mapTask)
          .filter((t): t is NonNullable<ReturnType<typeof mapTask>> => t !== null),
      };
    },

    clearLocalData() {
      localTaskService.clearTasks();
      localTemplateService.clearTemplates();
      localCategoryService.clearCategories();
      this.tasks = [];
      this.templates = [];
      this.categories = [];
      this.todayTasks = [];
      this.todayTasksDay = null;
    },

    // --- Categories ---
    async addCategory(categoryData: Omit<Category, "id">): Promise<Category | null> {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      try {
        const newCategory: Category = authStore.isAuthenticated
          ? await sessionBound(() => apiDataService.createCategory(categoryData))
          : { ...categoryData, id: uuidv4() };
        this.categories.push(newCategory);
        uiStore.showToast("Category added", "success", 2500);
        return newCategory;
      } catch (error) {
        if (isSessionChangedError(error)) return null;
        uiStore.showToast(apiErrorMessage(error, "Couldn't add the category."), "error");
        console.error(error);
        return null;
      }
    },

    async updateCategory(updatedCategory: Category): Promise<boolean> {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const index = this.categories.findIndex((c) => c.id === updatedCategory.id);
      if (index === -1) return false;

      try {
        if (authStore.isAuthenticated) {
          await sessionBound(() =>
            apiDataService.updateCategory(updatedCategory.id, {
              name: updatedCategory.name,
              color: updatedCategory.color,
            })
          );
        }
        this.categories[index] = updatedCategory;
        this.syncCategoryFields(updatedCategory.id, updatedCategory);
        uiStore.showToast("Category saved", "success", 2500);
        return true;
      } catch (error) {
        if (isSessionChangedError(error)) return false;
        uiStore.showToast(apiErrorMessage(error, "Couldn't save the category."), "error");
        console.error(error);
        return false;
      }
    },

    async deleteCategory(categoryId: string): Promise<boolean> {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const otherCat = this.otherCategory;

      if (!otherCat || categoryId === otherCat.id) {
        uiStore.showToast("The default “Other” category can't be deleted.", "error");
        return false;
      }

      try {
        if (authStore.isAuthenticated) {
          // The backend re-assigns tasks and templates; refresh templates from the server.
          this.templates = await sessionBound(async () => {
            await apiDataService.deleteCategory(categoryId);
            return apiDataService.getTaskTemplates();
          });
        }
        // Re-assign locally (guest: the source of truth; signed in: mirrors the server).
        this.syncCategoryFields(categoryId, otherCat);
        this.categories = this.categories.filter((c) => c.id !== categoryId);
        uiStore.showToast("Category deleted. Its items moved to “Other”.", "info");
        return true;
      } catch (error) {
        if (isSessionChangedError(error)) return false;
        uiStore.showToast(apiErrorMessage(error, "Couldn't delete the category."), "error");
        console.error(error);
        return false;
      }
    },

    /** Point every task/template of category `fromId` at `to` and refresh the denormalized fields. */
    syncCategoryFields(fromId: string, to: Category) {
      const apply = (item: { categoryId: string; categoryName: string; categoryColor: string }) => {
        if (item.categoryId !== fromId) return;
        item.categoryId = to.id;
        item.categoryName = to.name;
        item.categoryColor = to.color;
      };
      this.tasks.forEach(apply);
      this.todayTasks.forEach(apply);
      this.templates.forEach(apply);
    },

    // --- Tasks ---
    /**
     * Create a task. Returns the created task, or `null` (an error toast explains why unless
     * `silent`). No success toast: the task appearing on the calendar is the feedback.
     */
    async addTask(taskData: NewTaskData, options: AddTaskOptions = {}): Promise<Task | null> {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const fail = (message: string): null => {
        if (!options.silent) uiStore.showToast(message, "error", 4000, { key: TOAST_KEYS.addTask });
        return null;
      };

      const category = this.getCategoryById(taskData.categoryId);
      if (!category) return fail("Pick a category for this task.");
      const start = canonicalStart(taskData.start);
      if (start === null) return fail("Please enter a valid date and start time.");
      taskData = { ...taskData, start };

      let newTask: Task;
      if (authStore.isAuthenticated) {
        try {
          const body = taskData;
          newTask = await sessionBound(() => apiDataService.createTask(body));
        } catch (error) {
          // Logged out while the server was answering: the task belongs to the old session.
          if (isSessionChangedError(error)) return null;
          this.refreshAfterRejection(error);
          return fail(apiErrorMessage(error, "Couldn't add the task."));
        }
      } else {
        const clash = this.tasks.find((existing) => isOverlapping(taskData, existing));
        if (clash) return fail(overlapMessage(clash));
        newTask = {
          ...taskData,
          id: uuidv4(),
          categoryName: category.name,
          categoryColor: category.color,
        };
      }

      taskMutations += 1;
      this.tasks.push(newTask);
      if (this.isInTodayList(newTask)) this.todayTasks.push(newTask);
      uiStore.dismissToast(TOAST_KEYS.addTask); // a retry worked: its earlier error is stale
      return newTask;
    },

    /**
     * Save changes to a task. Returns `true` on success. Errors (server message verbatim, overlap,
     * network) are toasted unless `silent`. The second argument may be a boolean (= silent).
     */
    async updateTask(
      updatedTask: Task,
      options: boolean | UpdateTaskOptions = {}
    ): Promise<boolean> {
      const opts: UpdateTaskOptions = typeof options === "boolean" ? { silent: options } : options;
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const toastKey = TOAST_KEYS.updateTask(updatedTask.id);
      const fail = (message: string, action?: ToastAction): false => {
        if (!opts.silent) {
          uiStore.showToast(message, "error", action ? 8000 : 4000, action ? { action, key: toastKey } : { key: toastKey });
        }
        return false;
      };

      // Guests hold every task locally, so an unknown id means it was deleted. Signed-in users only
      // hold the visible week: a task dragged into another week may no longer be in the list
      // (the server is the authority and answers 404 for a deleted task).
      const known =
        this.tasks.some((t) => t.id === updatedTask.id) ||
        this.todayTasks.some((t) => t.id === updatedTask.id);
      if (!known && !authStore.isAuthenticated) return false;

      // Org tasks an admin assigned to me are read-only (Q1); the UI blocks this earlier, the
      // server refuses it too — this is the safety net.
      if (!canEditTask(updatedTask)) return fail(managedMessage(updatedTask));

      const start = canonicalStart(updatedTask.start);
      if (start === null) return fail("Please enter a valid date and start time.");
      const category = this.getCategoryById(updatedTask.categoryId);
      updatedTask = {
        ...updatedTask,
        start,
        categoryName: category?.name ?? updatedTask.categoryName,
        categoryColor: category?.color ?? updatedTask.categoryColor,
      };

      const taskDataForApi = {
        title: updatedTask.title,
        start: updatedTask.start,
        duration: updatedTask.duration,
        categoryId: updatedTask.categoryId,
        templateId: updatedTask.templateId,
      };

      if (authStore.isAuthenticated) {
        try {
          // Org tasks are saved through the organization (personal endpoints refuse them).
          const task = updatedTask;
          await sessionBound(() =>
            isOrgTask(task)
              ? apiDataService.updateOrganizationTask(task.organizationId!, task.id, taskDataForApi)
              : apiDataService.updateTask(task.id, taskDataForApi)
          );
        } catch (error) {
          if (isSessionChangedError(error)) return false;
          this.refreshAfterRejection(error);
          return fail(apiErrorMessage(error, "Couldn't save the task."), isBadRequest(error) ? opts.errorAction : undefined);
        }
      } else {
        const clash = this.tasks.find((t) => t.id !== updatedTask.id && isOverlapping(taskDataForApi, t));
        if (clash) return fail(overlapMessage(clash));
      }

      this.replaceTaskLocally(updatedTask);
      taskMutations += 1;
      uiStore.dismissToast(toastKey); // a retry worked: its earlier error is stale
      return true;
    },

    /**
     * Save a drag/keyboard move. When the task left the view (another week, or another day on
     * phones), a "Moved to Monday, October 12" toast offers Undo for 6 seconds (Ctrl/⌘+Z too):
     * Undo moves it back and shows its original day again.
     */
    async moveTask(
      updated: Task,
      original: Task,
      options: { announceDestination?: boolean; errorAction?: ToastAction } = {}
    ): Promise<boolean> {
      const uiStore = useUIStore();
      const ok = await this.updateTask(updated, { silentSuccess: true, errorAction: options.errorAction });
      if (!ok || !options.announceDestination) return ok;

      const epoch = useAuthStore().sessionEpoch;
      const day = toDateKey(updated.start);
      uiStore.showToast(`Moved to ${formatDate(day, "weekday")}`, "success", 6000, {
        undo: true,
        action: {
          label: "Undo",
          onClick: () => {
            // The move belongs to the session it was made in (never undo it into another one).
            if (useAuthStore().sessionEpoch !== epoch) return;
            const back: Task = { ...updated, start: original.start, duration: original.duration };
            void this.updateTask(back, { silentSuccess: true }).then((restored) => {
              if (!restored) return;
              uiStore.currentDate = toDateKey(original.start);
              uiStore.requestTaskFocus(original.id);
            });
          },
        },
      });
      return true;
    },

    /** Put `task` into `tasks` and keep `todayTasks` consistent with its (new) start. */
    replaceTaskLocally(task: Task) {
      const index = this.tasks.findIndex((t) => t.id === task.id);
      if (index !== -1) this.tasks[index] = task;
      else this.tasks.push(task);

      const todayIndex = this.todayTasks.findIndex((t) => t.id === task.id);
      const belongsToday = this.isInTodayList(task);
      if (todayIndex !== -1 && belongsToday) this.todayTasks[todayIndex] = task;
      else if (todayIndex !== -1) this.todayTasks.splice(todayIndex, 1);
      else if (belongsToday) this.todayTasks.push(task);
    },

    /** Whether a task belongs in the signed-in Today list that is currently loaded. */
    isInTodayList(task: Pick<Task, "start">): boolean {
      return this.todayTasksDay !== null && isInRange(task.start, dayRange(this.todayTasksDay));
    },

    /**
     * Delete a task optimistically: it disappears at once and a "Task deleted" toast offers Undo
     * for 6 seconds (Ctrl/⌘+Z works too). If the server refuses, the task is restored.
     */
    async deleteTask(taskId: string, options: { undo?: boolean } = {}): Promise<boolean> {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const withUndo = options.undo ?? true;

      const original = this.getTaskById(taskId);
      if (!original) return false;
      if (!canDeleteTask(original)) {
        uiStore.showToast(
          isOrgTask(original) && canEditTask(original)
            ? "Only admins or the person who created this task can delete it."
            : managedMessage(original),
          "info"
        );
        return false;
      }
      const taskIndex = this.tasks.findIndex((t) => t.id === taskId);
      const todayIndex = this.todayTasks.findIndex((t) => t.id === taskId);

      if (taskIndex !== -1) this.tasks.splice(taskIndex, 1);
      if (todayIndex !== -1) this.todayTasks.splice(todayIndex, 1);
      taskMutations += 1; // a week response already in flight may still contain it

      const restore = () => {
        if (taskIndex !== -1 && !this.tasks.some((t) => t.id === taskId)) {
          this.tasks.splice(Math.min(taskIndex, this.tasks.length), 0, original);
        }
        if (todayIndex !== -1 && !this.todayTasks.some((t) => t.id === taskId)) {
          this.todayTasks.splice(Math.min(todayIndex, this.todayTasks.length), 0, original);
        }
      };

      // Signed in: the server request. Resolves true when the task is gone for good.
      const epoch = authStore.sessionEpoch;
      const request = () =>
        sessionBound(() =>
          isOrgTask(original)
            ? apiDataService.deleteOrganizationTask(original.organizationId!, taskId)
            : apiDataService.deleteTask(taskId)
        );
      const toastKey = TOAST_KEYS.deleteTask(taskId);
      const deleted: Promise<boolean> = authStore.isAuthenticated
        ? request().then(
            () => {
              taskMutations += 1;
              uiStore.dismissToast(toastKey); // a retry worked: its earlier error is stale
              return true;
            },
            (error: unknown) => {
              // Logged out meanwhile: the state now belongs to another session; restore nothing.
              if (isSessionChangedError(error)) return false;
              console.error(error);
              restore();
              this.refreshAfterRejection(error);
              uiStore.showToast(apiErrorMessage(error, "Couldn't delete the task."), "error", 4000, { key: toastKey });
              return false;
            }
          )
        : Promise.resolve(true);

      if (withUndo) {
        uiStore.showToast("Task deleted", "info", 6000, {
          undo: true,
          action: {
            label: "Undo",
            // Wait for a DELETE still in flight (cold server): re-creating first would hit the
            // overlap rule against the not-yet-deleted original, and the DELETE would then remove
            // the task for good. If the DELETE failed, the task was already restored.
            onClick: () => {
              void deleted.then((ok) => {
                // Never re-create one session's task in another (e.g. Undo right after logout).
                if (!ok || useAuthStore().sessionEpoch !== epoch) return;
                if (isOrgTask(original)) {
                  void this.restoreOrganizationTask(original);
                  return;
                }
                void this.addTask({
                  title: original.title,
                  start: original.start,
                  duration: original.duration,
                  categoryId: original.categoryId,
                  templateId: original.templateId,
                });
              });
            },
          },
        });
      }

      return deleted;
    },

    /**
     * Undo of a deleted org task: re-create it in its organization — with the same assignees
     * when I may (re)assign, else as my own org task. It gets a new id.
     */
    async restoreOrganizationTask(original: Task): Promise<Task | null> {
      const uiStore = useUIStore();
      const assigneeIds = taskCapabilities(original).canReassign
        ? (original.assignees ?? []).map((a) => a.userId).filter(Boolean)
        : null;
      try {
        const created = await sessionBound(() =>
          apiDataService.createOrganizationTask(
            original.organizationId!,
            { title: original.title, start: original.start, duration: original.duration, categoryId: original.categoryId },
            assigneeIds
          )
        );
        taskMutations += 1;
        this.tasks.push(created);
        if (this.isInTodayList(created)) this.todayTasks.push(created);
        return created;
      } catch (error) {
        if (isSessionChangedError(error)) return null;
        this.refreshAfterRejection(error);
        uiStore.showToast(apiErrorMessage(error, "Couldn't restore the task."), "error");
        return null;
      }
    },

    // --- Templates ---
    async addTemplate(
      templateData: Omit<TaskTemplate, "id" | "categoryName" | "categoryColor">
    ): Promise<TaskTemplate | null> {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const category = this.getCategoryById(templateData.categoryId);

      if (!category) {
        uiStore.showToast("Pick a category for this template.", "error");
        return null;
      }

      try {
        const newTemplate: TaskTemplate = authStore.isAuthenticated
          ? await sessionBound(() => apiDataService.createTaskTemplate(templateData))
          : {
              ...templateData,
              id: uuidv4(),
              categoryName: category.name,
              categoryColor: category.color,
            };
        this.templates.push(newTemplate);
        uiStore.showToast("Template added", "success", 2500);
        return newTemplate;
      } catch (error) {
        if (isSessionChangedError(error)) return null;
        console.error("Failed to create template:", error);
        uiStore.showToast(apiErrorMessage(error, "Couldn't add the template."), "error");
        return null;
      }
    },

    async deleteTemplate(templateId: string): Promise<boolean> {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      try {
        if (authStore.isAuthenticated) await sessionBound(() => apiDataService.deleteTaskTemplate(templateId));
        this.templates = this.templates.filter((t) => t.id !== templateId);
        uiStore.showToast("Template deleted", "info", 2500);
        return true;
      } catch (error) {
        if (isSessionChangedError(error)) return false;
        console.error("Failed to delete template:", error);
        uiStore.showToast(apiErrorMessage(error, "Couldn't delete the template."), "error");
        return false;
      }
    },

    async updateTemplate(updatedTemplate: TaskTemplate): Promise<boolean> {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const index = this.templates.findIndex((t) => t.id === updatedTemplate.id);
      if (index === -1) return false;

      const category = this.getCategoryById(updatedTemplate.categoryId);
      updatedTemplate = {
        ...updatedTemplate,
        categoryName: category?.name ?? updatedTemplate.categoryName,
        categoryColor: category?.color ?? updatedTemplate.categoryColor,
      };

      try {
        if (authStore.isAuthenticated) {
          const template = updatedTemplate;
          await sessionBound(() =>
            apiDataService.updateTaskTemplate(template.id, {
              title: template.title,
              duration: template.duration,
              categoryId: template.categoryId,
            })
          );
        }
        this.templates[index] = updatedTemplate;
        uiStore.showToast("Template saved", "success", 2500);
        return true;
      } catch (error) {
        if (isSessionChangedError(error)) return false;
        console.error("Failed to update template:", error);
        uiStore.showToast(apiErrorMessage(error, "Couldn't save the template."), "error");
        return false;
      }
    },

    /**
     * Fill `todayTasks` with the tasks starting on `day` (default: today in the user's zone),
     * i.e. in `[start of day, start of next day)`. Uses its own loading/error flags.
     */
    async fetchTodayTasks(day: DateKey = todayKey()) {
      const authStore = useAuthStore();
      const range = dayRange(day);

      if (!authStore.isAuthenticated) {
        // GUEST: filter the local list. On a hard refresh this view can mount before App.vue
        // has initialized the store, so load guest data first if needed.
        if (!this.guestDataLoaded) this.loadGuestData();
        this.todayTasks = this.tasks.filter((task) => isInRange(task.start, range));
        this.todayTasksDay = day;
        this.todayError = null;
        return;
      }

      const seq = ++todayRequestSeq;
      this.isLoadingToday = true;
      this.todayError = null;
      try {
        // Filtered again in case an older backend returns a wider range.
        const tasks = await sessionBound(() => apiDataService.getTasksForDay(day));
        if (seq !== todayRequestSeq) return;
        this.todayTasks = tasks.filter((task) => isInRange(task.start, range));
        this.todayTasksDay = day;
      } catch (error) {
        if (seq !== todayRequestSeq || isSessionChangedError(error)) return;
        console.error("Failed to fetch today's tasks:", error);
        this.todayError = TODAY_ERROR_MESSAGE;
      } finally {
        if (seq === todayRequestSeq) this.isLoadingToday = false;
      }
    },
  },
  // Pinia SSR-hydration hook (not invoked in this client-only app; guest data is loaded by
  // initializeData/loadGuestData). Kept for parity with the original store.
  hydrate(state) {
    const authStore = useAuthStore();
    if (!authStore.isAuthenticated) {
      state.categories = localCategoryService.getCategories();
      state.templates = localTemplateService.getTemplates();
      state.tasks = localTaskService.getTasks();
    }
  },
});

/**
 * Whether the task store's state may be written to guest storage: signed out, guest data loaded
 * (never write an empty pre-load state over the stored data), and loaded in the CURRENT session
 * epoch — right after a logout the state still holds account data until loadGuestData() runs,
 * and a late answer for the old session must never be persisted as guest data either.
 */
export function canPersistGuestData(
  state: { guestDataLoaded: boolean; guestSessionEpoch: number | null },
  auth: { isAuthenticated: boolean; sessionEpoch: number }
): boolean {
  return !auth.isAuthenticated && state.guestDataLoaded && state.guestSessionEpoch === auth.sessionEpoch;
}

/** Persist guest-mode changes to localStorage. */
export function setupTaskStoreSubscribers() {
  const taskStore = useTaskStore();
  const authStore = useAuthStore();

  taskStore.$subscribe((_mutation, state) => {
    if (!canPersistGuestData(state, authStore)) return;
    localTaskService.saveTasks(state.tasks);
    localTemplateService.saveTemplates(state.templates);
    localCategoryService.saveCategories(state.categories);
  });
}
