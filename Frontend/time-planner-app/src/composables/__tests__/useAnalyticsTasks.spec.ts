/**
 * The analytics task list data: guests list their local tasks of the range and the grand total
 * equals the KPIs (total time, task count); signed-in users fetch /api/tasks for the same
 * half-open range as /api/tasks/analytics, race-safe across filter changes, map org tasks to the
 * organization's analytics category, say "You" for their own tasks, and refetch after a task was
 * changed from the editor.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, effectScope, nextTick, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type { Task } from "@/types";

vi.mock("@/services/apiDataService", () => ({
  apiDataService: {
    getTasks: vi.fn(),
    getTaskAnalytics: vi.fn(),
    getTaskYears: vi.fn(async () => [2026]),
    updateTask: vi.fn(async () => {}),
    deleteTask: vi.fn(async () => {}),
    getMyProfile: vi.fn(async () => ({ id: "me", email: "me@example.com", displayName: "Me" })),
  },
}));
vi.mock("@/services/authService", () => ({ authService: {} }));

import { apiDataService } from "@/services/apiDataService";
import { useAnalyticsTasks } from "../useAnalyticsTasks";
import { useStats } from "../useStats";
import { useTaskStore } from "@/stores/taskStore";
import { useAuthStore } from "@/stores/authStore";
import { analyticsRange, type AnalyticsSelection } from "@/lib/analyticsBuckets";
import { combineDateAndTime, type InstantRange } from "@/lib/datetime";
import { taskListTotals } from "@/lib/taskList";
import { TEST_ZONE } from "@/lib/__tests__/tz";

const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, String(value)),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
  },
});

const api = vi.mocked(apiDataService);

const WORK = { id: "c-work", name: "Work", color: "#2F7FE0" };
const GYM = { id: "c-gym", name: "Gym", color: "#3D9A50" };

function task(id: string, day: string, time: string, hours: number, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    start: combineDateAndTime(day, time),
    duration: hours,
    categoryId: WORK.id,
    categoryName: WORK.name,
    categoryColor: WORK.color,
    ...patch,
  };
}

const selection = (patch: Partial<AnalyticsSelection> = {}): AnalyticsSelection => ({
  view: "weekly",
  year: 2026,
  monthRange: { start: 0, end: 11 },
  weekRange: { start: 41, end: 42 },
  dailyWeek: 42,
  ...patch,
});

/** A signed-in user's access token (only the `sub` claim matters). */
const tokenFor = (userId: string) =>
  ["header", Buffer.from(JSON.stringify({ sub: userId })).toString("base64url"), "sig"].join(".");

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await nextTick();
};

const realWarn = console.warn;
beforeEach(() => {
  memory.clear();
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("onMounted is called when there is no active component")) return;
    realWarn(...args);
  });
});

describe(`useAnalyticsTasks — guest (${TEST_ZONE})`, () => {
  function setupGuest() {
    useAuthStore().accessToken = null;
    const store = useTaskStore();
    store.categories = [WORK, GYM];
    store.templates = [
      { id: "tpl-1", title: "Morning run", duration: 1, categoryId: GYM.id, categoryName: "Gym", categoryColor: GYM.color },
    ];
    store.tasks = [
      task("w41-mon", "2026-10-05", "08:00", 1.5),
      task("w41-late", "2026-10-07", "23:00", 2.25, { categoryId: GYM.id, categoryName: "Gym", categoryColor: GYM.color }),
      task("w42-run", "2026-10-13", "06:30", 0.75, { templateId: "tpl-1", categoryId: GYM.id }),
      task("w42-sun", "2026-10-18", "23:45", 0.1),
      task("w40", "2026-10-04", "12:00", 5), // before the range
      task("w43", "2026-10-19", "00:00", 4), // after the range (half-open end)
    ];
    store.guestDataLoaded = true;
    const sel = ref(selection());
    const scope = effectScope();
    const { stats, list } = scope.run(() => {
      const filters = {
        year: computed(() => sel.value.year),
        view: computed(() => sel.value.view),
        monthRange: computed(() => sel.value.monthRange),
        weekRange: computed(() => sel.value.weekRange),
        dailyWeek: computed(() => sel.value.dailyWeek),
      };
      const stats = useStats().useFilteredStats(filters as never);
      const list = useAnalyticsTasks({
        selection: sel,
        categories: () => stats.snapshot.value?.categories ?? [],
      });
      return { stats, list };
    })!;
    return { store, sel, stats, list, scope };
  }

  it("lists the range's local tasks; the grand total equals the Total time and task count KPIs", () => {
    const { stats, list, scope } = setupGuest();
    const snapshot = stats.snapshot.value!;
    const rows = list.rows.value;
    expect(rows.map((r) => r.id)).toEqual(["w41-mon", "w41-late", "w42-run", "w42-sun"]);
    const totals = taskListTotals(rows);
    expect(totals.count).toBe(snapshot.taskCount);
    expect(totals.hours).toBeCloseTo(snapshot.totalHours, 10);
    // Same categories (name + color) as the donut.
    for (const row of rows) {
      const slice = snapshot.categories.find((c) => c.id === row.category.id)!;
      expect(row.category).toEqual({ id: slice.id, name: slice.name, color: slice.color });
    }
    expect(rows.find((r) => r.id === "w42-run")!.templateTitle).toBe("Morning run");
    expect(rows.every((r) => r.createdBy === "You")).toBe(true);
    expect(list.isLoading.value).toBe(false);
    expect(list.error.value).toBeNull();
    scope.stop();
  });

  it("follows the selection and edits of the local tasks", async () => {
    const { store, sel, stats, list, scope } = setupGuest();
    sel.value = selection({ weekRange: { start: 42, end: 42 } });
    await nextTick();
    expect(list.rows.value.map((r) => r.id)).toEqual(["w42-run", "w42-sun"]);
    expect(taskListTotals(list.rows.value).count).toBe(stats.snapshot.value!.taskCount);

    store.tasks[2] = { ...store.tasks[2]!, duration: 2 };
    await nextTick();
    expect(list.rows.value.find((r) => r.id === "w42-run")!.hours).toBe(2);
    expect(taskListTotals(list.rows.value).hours).toBeCloseTo(stats.snapshot.value!.totalHours, 10);
    scope.stop();
  });
});

describe(`useAnalyticsTasks — signed in (${TEST_ZONE})`, () => {
  interface Pending {
    range: InstantRange;
    resolve: (tasks: Task[]) => void;
    reject: (error: unknown) => void;
  }

  function setupSignedIn(onTasksChanged = vi.fn()) {
    useAuthStore().accessToken = tokenFor("me");
    const store = useTaskStore();
    store.categories = [WORK];
    store.templates = [];
    const pending: Pending[] = [];
    const getTasks = vi.fn(
      (range: InstantRange) =>
        new Promise<Task[]>((resolve, reject) => {
          pending.push({ range, resolve, reject });
        })
    );
    const sel = ref(selection());
    const categories = ref([
      { id: WORK.id, name: "Work", color: "#2F7FE0" },
      { id: "org-1", name: "Acme", color: "#0E9C8C" },
    ]);
    const scope = effectScope();
    const list = scope.run(() =>
      useAnalyticsTasks({ selection: sel, categories: () => categories.value, onTasksChanged, deps: { getTasks } })
    )!;
    return { store, sel, list, pending, getTasks, scope, onTasksChanged };
  }

  it("fetches the same half-open range as the analytics request", () => {
    const { pending, scope, list } = setupSignedIn();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.range).toEqual(analyticsRange(selection()));
    expect(list.isLoading.value).toBe(true);
    expect(list.isRefetching.value).toBe(false);
    scope.stop();
  });

  it("is race-safe: a slow response for an old selection never replaces the newer one", async () => {
    const { sel, list, pending, scope } = setupSignedIn();
    pending[0]!.resolve([task("first", "2026-10-06", "09:00", 1)]);
    await flush();
    expect(list.rows.value.map((r) => r.id)).toEqual(["first"]);

    sel.value = selection({ weekRange: { start: 30, end: 30 } });
    await nextTick();
    sel.value = selection({ weekRange: { start: 31, end: 31 } });
    await nextTick();
    expect(pending).toHaveLength(3);
    expect(list.isRefetching.value).toBe(true);
    expect(list.rows.value.map((r) => r.id)).toEqual(["first"]); // previous rows stay meanwhile
    // …and say which range they are (the page's captions describe the rows on screen).
    expect(list.selection.value?.weekRange).toEqual({ start: 41, end: 42 });

    pending[2]!.resolve([task("w31", "2026-07-28", "09:00", 1)]);
    await flush();
    pending[1]!.resolve([task("w30-stale", "2026-07-21", "09:00", 1)]);
    await flush();
    expect(list.rows.value.map((r) => r.id)).toEqual(["w31"]);
    expect(list.selection.value?.weekRange).toEqual({ start: 31, end: 31 });
    expect(list.isRefetching.value).toBe(false);
    scope.stop();
  });

  it("maps org tasks to the organization's analytics category and names other creators", async () => {
    const { list, pending, scope } = setupSignedIn();
    pending[0]!.resolve([
      task("mine", "2026-10-06", "09:00", 1, { createdBy: { userId: "me", displayName: "Me" } }),
      task("assigned", "2026-10-06", "11:00", 2, {
        organizationId: "org-1",
        organizationName: "Acme",
        categoryId: "their-cat",
        categoryName: "Sales",
        categoryColor: "#AA3355",
        createdBy: { userId: "admin", displayName: "Ada Admin" },
        capabilities: { canEdit: false, canDelete: false, canReassign: false },
      }),
    ]);
    await flush();
    const [mine, assigned] = list.rows.value;
    expect(mine!.createdBy).toBe("You");
    expect(assigned!.category).toEqual({ id: "org-1", name: "Acme", color: "#0E9C8C" });
    expect(assigned!.organizationName).toBe("Acme");
    expect(assigned!.createdBy).toBe("Ada Admin");
    scope.stop();
  });

  it("shows the error, and Retry loads again", async () => {
    const { list, pending, scope } = setupSignedIn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    pending[0]!.reject(new Error("Network Error"));
    await flush();
    expect(list.error.value).toBe("Network Error");
    expect(list.isLoading.value).toBe(false);

    void list.refetch();
    expect(list.isLoading.value).toBe(true);
    pending[1]!.resolve([]);
    await flush();
    expect(list.error.value).toBeNull();
    expect(list.rows.value).toEqual([]);
    scope.stop();
  });

  it("refetches (and tells the page) after a task was saved from the editor", async () => {
    const { store, list, pending, getTasks, scope, onTasksChanged } = setupSignedIn();
    const original = task("t1", "2026-10-06", "09:00", 1);
    pending[0]!.resolve([original]);
    await flush();
    expect(getTasks).toHaveBeenCalledTimes(1);

    store.replaceTaskLocally(original); // what the page does before opening the editor
    await flush();
    expect(getTasks).toHaveBeenCalledTimes(1); // not a change

    expect(await store.updateTask({ ...original, duration: 2 }, { silentSuccess: true })).toBe(true);
    await flush();
    expect(api.updateTask).toHaveBeenCalledTimes(1);
    expect(getTasks).toHaveBeenCalledTimes(2);
    expect(onTasksChanged).toHaveBeenCalledTimes(1);

    pending[1]!.resolve([{ ...original, duration: 2 }]);
    await flush();
    expect(list.rows.value[0]!.hours).toBe(2);
    scope.stop();
  });
});
