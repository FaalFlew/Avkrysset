/**
 * Paste / duplicate through the stores (backlog item 3): a copy that would overlap is refused with
 * the move's message and nothing is created (no API call either); Undo removes just the copy; and
 * a copy never outlives the session it was made in. The API layer is mocked; no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Task } from "@/types";
import { atMinutesOfDay } from "@/lib/datetime";

vi.mock("@/services/apiDataService", () => ({
  apiDataService: { createTask: vi.fn(), deleteTask: vi.fn() },
}));
vi.mock("@/services/authService", () => ({ authService: { revokeRefreshToken: vi.fn() } }));

import { apiDataService } from "@/services/apiDataService";
import { useTaskStore } from "../taskStore";
import { useAuthStore } from "../authStore";
import { useUIStore } from "../uiStore";
import { useClipboardStore } from "../clipboardStore";

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

const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";
const CATEGORY = { id: "c1", name: "Work", color: "#2F7FE0" };

function task(id: string, day: string, hour: number, title = "Deep work"): Task {
  return {
    id,
    title,
    start: atMinutesOfDay(day, hour * 60),
    duration: 1,
    categoryId: CATEGORY.id,
    categoryName: CATEGORY.name,
    categoryColor: CATEGORY.color,
  };
}

function setup(signedIn: boolean, tasks: Task[]) {
  memory.clear();
  if (signedIn) {
    memory.set("accessToken", "token");
    memory.set("refreshToken", "refresh");
  }
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.accessToken = signedIn ? "token" : null;
  auth.refreshToken = signedIn ? "refresh" : null;
  const store = useTaskStore();
  store.categories = [CATEGORY];
  store.tasks = tasks;
  if (!signedIn) {
    store.guestDataLoaded = true;
    store.guestSessionEpoch = auth.sessionEpoch;
  }
  return { auth, store, ui: useUIStore(), clipboard: useClipboardStore() };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.createTask.mockImplementation(async (data) => ({
    ...data,
    id: "created-on-server",
    categoryName: CATEGORY.name,
    categoryColor: CATEGORY.color,
  }));
  api.deleteTask.mockResolvedValue(undefined);
});

describe("paste / duplicate refused on overlap", () => {
  it("signed in: pasting onto a loaded task creates nothing and never calls the API", async () => {
    const { store, ui, clipboard } = setup(true, [task("a", MONDAY, 9), task("b", MONDAY, 11, "Lunch")]);
    clipboard.copy(store.tasks[0]!);

    expect(await clipboard.paste(atMinutesOfDay(MONDAY, 11 * 60 + 30))).toBeNull();
    expect(api.createTask).not.toHaveBeenCalled();
    expect(store.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(ui.toast).toMatchObject({ type: "error", message: "This time slot overlaps with an existing task." });
  });

  it("guest: duplicating to the next day onto a task there creates nothing", async () => {
    const { store, ui, clipboard } = setup(false, [task("a", MONDAY, 9), task("b", TUESDAY, 9, "Gym")]);

    expect(await clipboard.duplicate(store.tasks[0]!, 1)).toBeNull();
    expect(store.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(ui.toast.type).toBe("error");
  });
});

describe("Undo after a paste", () => {
  it("deletes only the pasted task (and shows no 'Task deleted' toast of its own)", async () => {
    const { store, ui, clipboard } = setup(true, [task("a", MONDAY, 9)]);
    clipboard.copy(store.tasks[0]!);

    const pasted = await clipboard.paste(atMinutesOfDay(MONDAY, 10 * 60));
    expect(pasted?.id).toBe("created-on-server");
    expect(store.tasks.map((t) => t.id)).toEqual(["a", "created-on-server"]);
    expect(ui.toast.message).toBe("Pasted “Deep work”");

    expect(ui.runToastUndo()).toBe(true);
    await flush();
    expect(api.deleteTask).toHaveBeenCalledTimes(1);
    expect(api.deleteTask).toHaveBeenCalledWith("created-on-server");
    expect(store.tasks.map((t) => t.id)).toEqual(["a"]);
    expect(ui.toast.isVisible).toBe(false);
  });
});

describe("the copy belongs to its session", () => {
  it("is gone after logout: nothing to paste into the guest planner", async () => {
    const { auth, store, clipboard } = setup(true, [task("a", MONDAY, 9)]);
    clipboard.copy(store.tasks[0]!, { arm: true });
    expect(clipboard.copied?.title).toBe("Deep work");

    await auth.logout();

    expect(clipboard.copied).toBeNull();
    expect(clipboard.isArmed).toBe(false); // the "Tap a time to paste" banner goes away
    expect(await clipboard.paste(atMinutesOfDay(TUESDAY, 9 * 60))).toBeNull();
    expect(api.createTask).not.toHaveBeenCalled();
  });
});
