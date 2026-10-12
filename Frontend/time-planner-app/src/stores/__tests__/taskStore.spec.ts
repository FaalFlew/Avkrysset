/**
 * taskStore: optimistic delete + Undo sequencing (review finding M1) and the 409 refresh (M6).
 * The API layer is mocked; no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Task } from "@/types";
import { toDateKey } from "@/lib/datetime";

vi.mock("@/services/apiDataService", () => ({
  apiDataService: {
    deleteTask: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    getTasks: vi.fn(),
    getTasksForDay: vi.fn(),
  },
}));
vi.mock("@/services/authService", () => ({ authService: {} }));

import { apiDataService } from "@/services/apiDataService";
import { useTaskStore } from "../taskStore";
import { useAuthStore } from "../authStore";
import { useUIStore } from "../uiStore";

// Minimal browser globals for the stores (node test environment).
const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, String(value)),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
  },
});
(globalThis as { window?: unknown }).window ??= globalThis;

const api = vi.mocked(apiDataService);
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const CATEGORY = { id: "c1", name: "Work", color: "#2F7FE0" };
function task(id = "t1"): Task {
  return {
    id,
    title: "Deep work",
    start: "2026-10-05T07:00:00.000Z",
    duration: 1,
    categoryId: CATEGORY.id,
    categoryName: CATEGORY.name,
    categoryColor: CATEGORY.color,
  };
}

function setup(signedIn: boolean) {
  memory.clear();
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.accessToken = signedIn ? "token" : null;
  const store = useTaskStore();
  const ui = useUIStore();
  store.categories = [CATEGORY];
  store.tasks = [task()];
  if (!signedIn) store.guestDataLoaded = true;
  return { store, ui };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.createTask.mockImplementation(async (data) => ({
    ...data,
    id: "recreated",
    categoryName: CATEGORY.name,
    categoryColor: CATEGORY.color,
  }));
});

describe("deleteTask + Undo (M1)", () => {
  it("waits for an in-flight DELETE before re-creating the task", async () => {
    const { store, ui } = setup(true);
    let finishDelete!: () => void;
    api.deleteTask.mockImplementation(() => new Promise<void>((resolve) => (finishDelete = resolve)));

    const result = store.deleteTask("t1");
    expect(store.tasks).toHaveLength(0); // optimistic
    expect(ui.toast.undo).toBe(true);

    expect(ui.runToastUndo()).toBe(true); // Undo while the DELETE is still pending
    await flush();
    expect(api.createTask).not.toHaveBeenCalled();

    finishDelete();
    expect(await result).toBe(true);
    await flush();
    expect(api.createTask).toHaveBeenCalledTimes(1);
    expect(store.tasks.map((t) => t.id)).toEqual(["recreated"]);
    ui.hideToast();
  });

  it("does not re-create when the DELETE failed (the task was restored instead)", async () => {
    const { store, ui } = setup(true);
    let failDelete!: (error: unknown) => void;
    api.deleteTask.mockImplementation(() => new Promise<void>((_, reject) => (failDelete = reject)));

    const result = store.deleteTask("t1");
    ui.runToastUndo();
    failDelete({ response: { status: 500 } });
    expect(await result).toBe(false);
    await flush();

    expect(api.createTask).not.toHaveBeenCalled();
    expect(store.tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(ui.toast.type).toBe("error");
    ui.hideToast();
  });

  it("guest: Undo re-adds the task locally", async () => {
    const { store, ui } = setup(false);
    expect(await store.deleteTask("t1")).toBe(true);
    expect(store.tasks).toHaveLength(0);
    ui.runToastUndo();
    await flush();
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0]!.title).toBe("Deep work");
    expect(api.deleteTask).not.toHaveBeenCalled();
    ui.hideToast();
  });
});

describe("moving a task to another week", () => {
  const NEXT_WEEK = "2026-10-12T07:00:00.000Z";

  it("toasts 'Moved to …' with Undo; Undo moves it back and shows its original day", async () => {
    const { store, ui } = setup(false);
    ui.currentDate = "2026-10-12"; // the view followed the drag into the next week
    const original = task();
    const ok = await store.moveTask({ ...original, start: NEXT_WEEK }, original, { announceDestination: true });
    expect(ok).toBe(true);
    expect(store.tasks[0]!.start).toBe(NEXT_WEEK);
    expect(ui.toast.message).toMatch(/^Moved to /);
    expect(ui.toast.undo).toBe(true);

    expect(ui.runToastUndo()).toBe(true);
    await flush();
    expect(store.tasks[0]!.start).toBe(original.start);
    expect(ui.currentDate).toBe(toDateKey(original.start));
    ui.hideToast();
  });

  it("Undo asks the planner to focus the restored task", async () => {
    const { store, ui } = setup(false);
    const original = task();
    await store.moveTask({ ...original, start: NEXT_WEEK }, original, { announceDestination: true });
    ui.runToastUndo();
    await flush();
    expect(ui.taskFocusRequest).toBe(original.id);
    ui.hideToast();
  });

  it("a 400 from the server gets the caller's action (e.g. Edit); a 409 does not", async () => {
    const { store, ui } = setup(true);
    const onClick = () => {};
    api.updateTask.mockRejectedValueOnce({
      response: { status: 400, data: { message: "Duration must be at most 24 hours." } },
    });
    await store.updateTask({ ...task(), duration: 30 }, { silentSuccess: true, errorAction: { label: "Edit", onClick } });
    expect(ui.toast.message).toBe("Duration must be at most 24 hours.");
    expect(ui.toast.action?.label).toBe("Edit");

    api.updateTask.mockRejectedValueOnce({ response: { status: 409, data: { message: "Overlaps." } } });
    api.getTasks.mockResolvedValue([]);
    await store.updateTask({ ...task(), start: NEXT_WEEK }, { errorAction: { label: "Edit", onClick } });
    expect(ui.toast.action).toBeNull();
    ui.hideToast();
  });

  it("no toast for a move inside the visible week", async () => {
    const { store, ui } = setup(false);
    const original = task();
    await store.moveTask({ ...original, start: "2026-10-06T07:00:00.000Z" }, original);
    expect(ui.toast.isVisible).toBe(false);
  });

  it("signed in: saves a task that is no longer in the loaded week and shows it at once", async () => {
    const { store } = setup(true);
    store.tasks = []; // the next week's (empty) list has replaced the origin week
    api.updateTask.mockResolvedValue(undefined);
    const ok = await store.updateTask({ ...task(), start: NEXT_WEEK }, { silentSuccess: true });
    expect(ok).toBe(true);
    expect(api.updateTask).toHaveBeenCalledTimes(1);
    expect(store.tasks.map((t) => t.start)).toEqual([NEXT_WEEK]);
  });

  it("guest: an unknown (deleted) task is not saved", async () => {
    const { store } = setup(false);
    expect(await store.updateTask({ ...task("gone"), start: NEXT_WEEK })).toBe(false);
  });

  it("a week response that started before a drop does not wipe the dropped task", async () => {
    const { store } = setup(true);
    const range = { start: "2026-10-11T22:00:00.000Z", end: "2026-10-18T22:00:00.000Z" };
    const pending: ((tasks: Task[]) => void)[] = [];
    api.getTasks.mockImplementation(() => new Promise<Task[]>((resolve) => pending.push(resolve)));
    api.updateTask.mockResolvedValue(undefined);

    const fetching = store.fetchTasksForRange(range); // the view navigated to next week
    await store.updateTask({ ...task(), start: NEXT_WEEK }, { silentSuccess: true }); // dropped there
    pending[0]!([]); // stale: the server answered before the move was saved
    await fetching;
    expect(store.tasks.some((t) => t.start === NEXT_WEEK)).toBe(true);
    expect(api.getTasks).toHaveBeenCalledTimes(2); // asked again

    pending[1]!([{ ...task(), start: NEXT_WEEK }]);
    await flush();
    expect(store.tasks.map((t) => t.start)).toEqual([NEXT_WEEK]);
    expect(store.isLoadingWeek).toBe(false);
  });
});

describe("409 from the server (M6)", () => {
  it("shows the server's message and reloads the visible week", async () => {
    const { store, ui } = setup(true);
    const range = { start: "2026-10-04T22:00:00.000Z", end: "2026-10-11T22:00:00.000Z" };
    api.getTasks.mockResolvedValue([task()]);
    await store.fetchTasksForRange(range);
    expect(api.getTasks).toHaveBeenCalledTimes(1);

    api.updateTask.mockRejectedValue({
      response: { status: 409, data: { message: "This time slot overlaps with an existing task." } },
    });
    const ok = await store.updateTask({ ...task(), start: "2026-10-05T09:00:00.000Z" }, { silentSuccess: true });
    expect(ok).toBe(false);
    expect(ui.toast.message).toBe("This time slot overlaps with an existing task.");
    await flush();
    expect(api.getTasks).toHaveBeenCalledTimes(2);
    expect(api.getTasks).toHaveBeenLastCalledWith(range);
    ui.hideToast();
  });
});
