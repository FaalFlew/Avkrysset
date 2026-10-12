/**
 * taskStore and org tasks in "my planner" (D7): editable org tasks are saved/deleted through the
 * organization endpoints (optimistic + Undo + 409 kept), read-only ones are refused before any
 * request. The API layer is mocked; no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Task, TaskCapabilities } from "@/types";
import { toDateKey } from "@/lib/datetime";

vi.mock("@/services/apiDataService", () => ({
  apiDataService: {
    deleteTask: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    getTasks: vi.fn(),
    getTasksForDay: vi.fn(),
    updateOrganizationTask: vi.fn(),
    deleteOrganizationTask: vi.fn(),
    createOrganizationTask: vi.fn(),
  },
}));
vi.mock("@/services/authService", () => ({ authService: {} }));

import { apiDataService } from "@/services/apiDataService";
import { useTaskStore } from "../taskStore";
import { useAuthStore } from "../authStore";
import { useUIStore } from "../uiStore";

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

const ORG = "org-1";
const CATEGORY = { id: "c1", name: "Work", color: "#2F7FE0" };
const READ_ONLY: TaskCapabilities = { canEdit: false, canDelete: false, canReassign: false };
const MEMBER_OWN: TaskCapabilities = { canEdit: true, canDelete: true, canReassign: false };
const ADMIN: TaskCapabilities = { canEdit: true, canDelete: true, canReassign: true };
const WEEK = { start: "2026-10-05T00:00:00.000Z", end: "2026-10-12T00:00:00.000Z" };

function orgTask(id: string, capabilities: TaskCapabilities, hour = 9): Task {
  return {
    id,
    title: "Customer call",
    start: `2026-10-05T${String(hour).padStart(2, "0")}:00:00.000Z`,
    duration: 1,
    categoryId: CATEGORY.id,
    categoryName: CATEGORY.name,
    categoryColor: CATEGORY.color,
    organizationId: ORG,
    organizationName: "Acme",
    assignees: [
      { userId: "me", displayName: "Me", email: "me@example.com" },
      { userId: "u2", displayName: "Kari", email: "kari@example.com" },
    ],
    createdBy: { userId: "admin", displayName: "Ada" },
    capabilities,
  };
}

function setup(tasks: Task[]) {
  memory.clear();
  setActivePinia(createPinia());
  useAuthStore().accessToken = "token";
  const store = useTaskStore();
  const ui = useUIStore();
  store.categories = [CATEGORY];
  store.tasks = tasks;
  return { store, ui };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.updateOrganizationTask.mockResolvedValue(undefined);
  api.deleteOrganizationTask.mockResolvedValue(undefined);
  api.getTasks.mockResolvedValue([]);
  api.getTasksForDay.mockResolvedValue([]);
  api.createOrganizationTask.mockImplementation(async (organizationId, data) => ({
    ...orgTask("recreated", MEMBER_OWN),
    ...data,
    organizationId,
  }));
});

describe("updateTask", () => {
  it("an editable org task is saved through the organization endpoint", async () => {
    const task = orgTask("o1", MEMBER_OWN);
    const { store } = setup([task]);
    const moved = { ...task, start: "2026-10-05T11:00:00.000Z" };
    expect(await store.updateTask(moved)).toBe(true);
    expect(api.updateOrganizationTask).toHaveBeenCalledWith(ORG, "o1", expect.objectContaining({
      title: "Customer call",
      start: "2026-10-05T11:00:00.000Z",
      duration: 1,
      categoryId: "c1",
    }));
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(store.tasks[0]!.start).toBe("2026-10-05T11:00:00.000Z");
    expect(store.tasks[0]!.organizationName).toBe("Acme"); // org fields survive the local replace
  });

  it("a read-only org task is refused without a request", async () => {
    const task = orgTask("o1", READ_ONLY);
    const { store, ui } = setup([task]);
    expect(await store.updateTask({ ...task, title: "Renamed" })).toBe(false);
    expect(api.updateOrganizationTask).not.toHaveBeenCalled();
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(ui.toast.message).toBe("This task is managed in Acme.");
    expect(store.tasks[0]!.title).toBe("Customer call");
  });

  it("personal tasks still use /tasks", async () => {
    const personal: Task = { ...orgTask("p1", MEMBER_OWN), organizationId: null, organizationName: null, capabilities: undefined };
    const { store } = setup([personal]);
    expect(await store.updateTask({ ...personal, title: "Gym" })).toBe(true);
    expect(api.updateTask).toHaveBeenCalledWith("p1", expect.objectContaining({ title: "Gym" }));
    expect(api.updateOrganizationTask).not.toHaveBeenCalled();
  });

  it("409 from the org endpoint: the server's message, task unchanged, week reloaded", async () => {
    const task = orgTask("o1", MEMBER_OWN);
    const { store, ui } = setup([task]);
    // The server still has the task where it was.
    api.getTasks.mockResolvedValue([task]);
    await store.fetchTasksForRange({ start: "2026-10-05T00:00:00.000Z", end: "2026-10-12T00:00:00.000Z" });
    api.getTasks.mockClear();
    api.updateOrganizationTask.mockRejectedValue({
      response: { status: 409, data: { message: "This time overlaps a task assigned to you in Acme" } },
    });
    expect(await store.updateTask({ ...task, start: "2026-10-05T12:00:00.000Z" })).toBe(false);
    expect(ui.toast.message).toBe("This time overlaps a task assigned to you in Acme");
    expect(api.getTasks).toHaveBeenCalledTimes(1);
    await flush();
    expect(store.tasks.map((t) => t.start)).toEqual([task.start]);
  });

  it("a personal save that hits an assigned org task shows the server's 409 message", async () => {
    const personal: Task = { ...orgTask("p1", MEMBER_OWN), organizationId: null, organizationName: null, capabilities: undefined };
    const { store, ui } = setup([personal, orgTask("o1", READ_ONLY, 12)]);
    api.updateTask.mockRejectedValue({
      response: { status: 409, data: { message: "This time overlaps a task assigned to you in Acme" } },
    });
    expect(await store.updateTask({ ...personal, start: "2026-10-05T12:00:00.000Z" })).toBe(false);
    expect(ui.toast.message).toBe("This time overlaps a task assigned to you in Acme");
  });

  it("403 → permission copy (no logout, no token refresh — that lives in apiService)", async () => {
    const task = orgTask("o1", MEMBER_OWN);
    const { store, ui } = setup([task]);
    api.updateOrganizationTask.mockRejectedValue({ response: { status: 403, data: { message: "Forbidden" } } });
    expect(await store.updateTask({ ...task, title: "x" })).toBe(false);
    expect(ui.toast.message).toBe("You don't have permission to do that.");
  });

  it("403 → the week and Today are refetched, so the new (read-only) capabilities show up", async () => {
    const task = orgTask("o1", MEMBER_OWN);
    const { store } = setup([task]);
    await store.fetchTasksForRange(WEEK);
    await store.fetchTodayTasks(toDateKey(task.start)); // the task's own local day (any zone)
    api.getTasks.mockClear();
    api.getTasksForDay.mockClear();
    // Meanwhile an admin made it read-only for me.
    const nowReadOnly = { ...task, capabilities: READ_ONLY };
    api.getTasks.mockResolvedValue([nowReadOnly]);
    api.getTasksForDay.mockResolvedValue([nowReadOnly]);
    api.updateOrganizationTask.mockRejectedValue({ response: { status: 403 } });

    expect(await store.updateTask({ ...task, start: "2026-10-05T11:00:00.000Z" })).toBe(false);
    expect(api.getTasks).toHaveBeenCalledTimes(1);
    expect(api.getTasksForDay).toHaveBeenCalledTimes(1);
    await flush();
    expect(store.tasks[0]!.capabilities).toEqual(READ_ONLY);
    expect(store.todayTasks[0]!.capabilities).toEqual(READ_ONLY);
  });

  it("other errors (400/500) don't refetch", async () => {
    const task = orgTask("o1", MEMBER_OWN);
    const { store } = setup([task]);
    await store.fetchTasksForRange(WEEK);
    api.getTasks.mockClear();
    api.updateOrganizationTask.mockRejectedValueOnce({ response: { status: 400, data: { message: "Bad" } } });
    await store.updateTask({ ...task, title: "x" });
    api.updateOrganizationTask.mockRejectedValueOnce({ response: { status: 500 } });
    await store.updateTask({ ...task, title: "y" });
    expect(api.getTasks).not.toHaveBeenCalled();
  });
});

describe("deleteTask", () => {
  it("a read-only org task is refused with a toast and no request", async () => {
    const { store, ui } = setup([orgTask("o1", READ_ONLY)]);
    expect(await store.deleteTask("o1")).toBe(false);
    expect(api.deleteOrganizationTask).not.toHaveBeenCalled();
    expect(api.deleteTask).not.toHaveBeenCalled();
    expect(store.tasks).toHaveLength(1);
    expect(ui.toast.message).toBe("This task is managed in Acme.");
    expect(ui.toast.undo).toBeFalsy();
  });

  it("an org task I may edit but not delete says who can", async () => {
    const { store, ui } = setup([orgTask("o1", { canEdit: true, canDelete: false, canReassign: false })]);
    expect(await store.deleteTask("o1")).toBe(false);
    expect(ui.toast.message).toBe("Only admins or the person who created this task can delete it.");
    expect(api.deleteOrganizationTask).not.toHaveBeenCalled();
  });

  it("a deletable org task goes through the organization endpoint (optimistic)", async () => {
    const { store, ui } = setup([orgTask("o1", MEMBER_OWN)]);
    const result = store.deleteTask("o1");
    expect(store.tasks).toHaveLength(0);
    expect(ui.toast.undo).toBe(true);
    expect(await result).toBe(true);
    expect(api.deleteOrganizationTask).toHaveBeenCalledWith(ORG, "o1");
    expect(api.deleteTask).not.toHaveBeenCalled();
    ui.hideToast();
  });

  it("a 403 on an org delete restores the task and refetches the week (fresh capabilities)", async () => {
    const task = orgTask("o1", MEMBER_OWN);
    const { store, ui } = setup([task]);
    api.getTasks.mockResolvedValue([task]);
    await store.fetchTasksForRange(WEEK);
    api.getTasks.mockClear();
    const nowReadOnly = { ...task, capabilities: READ_ONLY };
    api.getTasks.mockResolvedValue([nowReadOnly]);
    api.deleteOrganizationTask.mockRejectedValue({ response: { status: 403 } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await store.deleteTask("o1")).toBe(false);
    spy.mockRestore();
    expect(store.tasks.map((t) => t.id)).toEqual(["o1"]);
    expect(ui.toast.message).toBe("You don't have permission to do that.");
    expect(api.getTasks).toHaveBeenCalledTimes(1);
    await flush();
    expect(store.tasks[0]!.capabilities).toEqual(READ_ONLY);
  });

  it("Undo of my own org task re-creates it as my org task (no assignees)", async () => {
    const { store, ui } = setup([orgTask("o1", MEMBER_OWN)]);
    expect(await store.deleteTask("o1")).toBe(true);
    ui.runToastUndo();
    await flush();
    expect(api.createOrganizationTask).toHaveBeenCalledWith(
      ORG,
      { title: "Customer call", start: "2026-10-05T09:00:00.000Z", duration: 1, categoryId: "c1" },
      null
    );
    expect(api.createTask).not.toHaveBeenCalled();
    expect(store.tasks.map((t) => t.id)).toEqual(["recreated"]);
    ui.hideToast();
  });

  it("Undo as Owner/Admin re-creates it with the same assignees", async () => {
    const { store, ui } = setup([orgTask("o1", ADMIN)]);
    expect(await store.deleteTask("o1")).toBe(true);
    ui.runToastUndo();
    await flush();
    expect(api.createOrganizationTask).toHaveBeenCalledWith(ORG, expect.any(Object), ["me", "u2"]);
    ui.hideToast();
  });
});
