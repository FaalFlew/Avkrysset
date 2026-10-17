// src/composables/useAnalyticsTasks.ts — the tasks behind the analytics page's task list
// (docs/plans/analytics-task-list.md), as rows ready for display (src/lib/taskList.ts):
// - guests: the local tasks starting in the selected range (recomputed when they change);
// - signed in: GET /api/tasks for the SAME half-open instant range the page sends to
//   /api/tasks/analytics (analyticsRange), race-safe like useStats: a response for a selection
//   that was replaced meanwhile is dropped, and the previous rows stay (dimmed) while refetching.
//   After a task is saved, deleted or restored anywhere (e.g. from the list's editor) the list is
//   fetched again and `onTasksChanged` runs (the page refetches its analytics with it).

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { storeToRefs } from "pinia";
import type { Task } from "@/types";
import { useTaskStore } from "@/stores/taskStore";
import { useAuthStore } from "@/stores/authStore";
import { apiDataService } from "@/services/apiDataService";
import { useTimeZone } from "@/composables/useClock";
import { useCurrentUserId } from "@/composables/useCurrentUser";
import { analyticsRange, type AnalyticsSelection } from "@/lib/analyticsBuckets";
import { isInRange, type InstantRange } from "@/lib/datetime";
import { buildTaskListRows, type TaskListCategory, type TaskListContext, type TaskListRow } from "@/lib/taskList";

/** Store actions that change tasks; the list refetches after one succeeds. */
const TASK_MUTATIONS = new Set(["addTask", "updateTask", "deleteTask", "restoreOrganizationTask"]);

export interface AnalyticsTasksOptions {
  /** The page's current filters. */
  selection: Ref<AnalyticsSelection> | ComputedRef<AnalyticsSelection>;
  /** The analytics categories on screen (name + color by id; org tasks use the org's entry). */
  categories: () => readonly TaskListCategory[];
  /** Signed in: called after a task was changed (in addition to the list's own refetch). */
  onTasksChanged?: () => void;
  deps?: {
    getTasks?: (range: InstantRange) => Promise<Task[]>;
  };
}

export interface AnalyticsTasks {
  /** Every task of the range, in list order (the previous range's while refetching). */
  rows: ComputedRef<TaskListRow[]>;
  /** First load in progress (no rows yet). */
  isLoading: ComputedRef<boolean>;
  /** A refetch is running while previous rows are shown. */
  isRefetching: ComputedRef<boolean>;
  /** Message of the last failed request, or null. */
  error: Readonly<Ref<string | null>>;
  /** Fetch again (no-op for guests). */
  refetch: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Request failed";
}

export function useAnalyticsTasks(options: AnalyticsTasksOptions): AnalyticsTasks {
  const store = useTaskStore();
  const { tasks: storeTasks, templates } = storeToRefs(store);
  const auth = useAuthStore();
  const { timeZone } = useTimeZone();
  const currentUserId = useCurrentUserId();
  const getTasks = options.deps?.getTasks ?? ((range: InstantRange) => apiDataService.getTasks(range));

  const context = computed<TaskListContext>(() => ({
    categories: options.categories(),
    categoryById: (id) => store.getCategoryById(id),
    templates: templates.value,
    currentUserId: currentUserId.value,
  }));

  if (!auth.isAuthenticated) {
    // GUEST: everything is local and reactive (edits from the editor show up at once).
    const rows = computed(() => {
      void timeZone.value; // day groups follow the device zone
      const range = analyticsRange(options.selection.value);
      return buildTaskListRows(
        storeTasks.value.filter((task) => isInRange(task.start, range)),
        context.value
      );
    });
    return {
      rows,
      isLoading: computed(() => false),
      isRefetching: computed(() => false),
      error: ref(null),
      refetch: async () => {},
    };
  }

  // SIGNED IN: fetch the range; keep the previous tasks on screen while a new range loads.
  const tasks = ref<Task[] | null>(null);
  const pending = ref(0);
  const error = ref<string | null>(null);
  let latestRequest = 0;

  async function load(sel: AnalyticsSelection): Promise<void> {
    const requestId = ++latestRequest;
    pending.value++;
    try {
      const data = await getTasks(analyticsRange(sel));
      if (requestId !== latestRequest) return; // a newer selection superseded this one
      tasks.value = data;
      error.value = null;
    } catch (e) {
      if (requestId !== latestRequest) return;
      console.error("Failed to fetch the analytics task list", e);
      error.value = errorMessage(e);
    } finally {
      pending.value--;
    }
  }

  const refetch = () => load(options.selection.value);

  watch(options.selection, (sel) => void load(sel), { immediate: true, deep: true });
  // Ranges are resolved in the device zone, so a zone change needs fresh data.
  watch(timeZone, () => void refetch());

  // A task saved/deleted/restored while the page is open (the list opens the editor).
  let refreshQueued = false;
  store.$onAction(({ name, after }) => {
    if (!TASK_MUTATIONS.has(name)) return;
    after((result) => {
      if (!result || refreshQueued) return;
      refreshQueued = true;
      queueMicrotask(() => {
        refreshQueued = false;
        void refetch();
        options.onTasksChanged?.();
      });
    });
  });

  return {
    rows: computed(() => (tasks.value ? buildTaskListRows(tasks.value, context.value) : [])),
    isLoading: computed(() => pending.value > 0 && tasks.value === null),
    isRefetching: computed(() => pending.value > 0 && tasks.value !== null),
    error,
    refetch,
  };
}
