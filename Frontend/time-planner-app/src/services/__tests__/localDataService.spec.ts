import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UNREADABLE_TASKS_STORAGE_KEY,
  localCategoryService,
  localTaskService,
} from "../localDataService";

const TASKS_KEY = "vue-time-planner-tasks";

/** Minimal in-memory localStorage for the node test environment. */
class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) {
    return this.items.has(key) ? this.items.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, String(value));
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}

const good = {
  id: "ok",
  title: "Readable",
  start: "2026-10-03T07:00:00.000Z",
  duration: 1,
  categoryId: "c",
  categoryName: "C",
  categoryColor: "#2F7FE0",
};
const bad = { ...good, id: "bad", title: "Unreadable", start: "next tuesday-ish" };

describe("guest storage keeps data it cannot read", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("skips a task with an unreadable start but preserves it under a separate key", () => {
    localStorage.setItem(TASKS_KEY, JSON.stringify([good, bad]));

    const tasks = localTaskService.getTasks();

    expect(tasks.map((t) => t.id)).toEqual(["ok"]);
    expect(console.warn).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(UNREADABLE_TASKS_STORAGE_KEY)!)).toEqual([bad]);
  });

  it("survives the store saving the filtered list back (no silent data loss)", () => {
    localStorage.setItem(TASKS_KEY, JSON.stringify([good, bad]));

    // What the task store's $subscribe does after loading guest data:
    localTaskService.saveTasks(localTaskService.getTasks());
    // ...and on the next app start:
    localTaskService.saveTasks(localTaskService.getTasks());

    expect(JSON.parse(localStorage.getItem(TASKS_KEY)!).map((t: { id: string }) => t.id)).toEqual([
      "ok",
    ]);
    // Preserved exactly once.
    expect(JSON.parse(localStorage.getItem(UNREADABLE_TASKS_STORAGE_KEY)!)).toEqual([bad]);
  });

  it("backs up a value that is not valid JSON before starting over", () => {
    localStorage.setItem(TASKS_KEY, "[{ broken json");
    expect(localTaskService.getTasks()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(UNREADABLE_TASKS_STORAGE_KEY)!)).toEqual([
      { unparsedJson: "[{ broken json" },
    ]);

    localStorage.setItem("vue-time-planner-categories", '{"not":"a list"}');
    expect(localCategoryService.getCategories()).toEqual([]);
    expect(JSON.parse(localStorage.getItem("vue-time-planner-categories-unreadable")!)).toEqual([
      { unparsedJson: '{"not":"a list"}' },
    ]);
  });

  it("normalizes legacy offset-less starts as local wall-clock time", () => {
    localStorage.setItem(TASKS_KEY, JSON.stringify([{ ...good, start: "2026-10-03 09:00:00" }]));
    const [task] = localTaskService.getTasks();
    expect(task!.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(localStorage.getItem(UNREADABLE_TASKS_STORAGE_KEY)).toBeNull();
  });
});
