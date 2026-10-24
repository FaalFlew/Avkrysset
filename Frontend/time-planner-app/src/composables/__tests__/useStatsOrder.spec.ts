/**
 * Analytics view model ordering (shared with the server): categories and templates by hours DESC,
 * then name (ordinal — plain `<`, not localeCompare), then id; the KPI "Top category" is the first.
 * Covers guest data and the signed-in API mapping. Deleted templates carry no category.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import type { Task, TaskAnalyticsResponse } from "@/types";
import type { AnalyticsView } from "@/lib/analyticsBuckets";

vi.mock("@/services/apiDataService", () => ({
  apiDataService: {
    getTaskAnalytics: vi.fn(),
    getTaskYears: vi.fn(async () => [2026]),
  },
}));
vi.mock("@/services/authService", () => ({ authService: {} }));

import { apiDataService } from "@/services/apiDataService";
import { useStats } from "../useStats";
import { useTaskStore } from "@/stores/taskStore";
import { useAuthStore } from "@/stores/authStore";
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

const CATEGORIES = [
  { id: "c3", name: "beta", color: "#2F7FE0" },
  { id: "c2", name: "Zeta", color: "#DA6A1C" },
  { id: "c9", name: "Alpha", color: "#0E9C8C" },
  { id: "c1", name: "Alpha", color: "#8E55CC" },
  { id: "c5", name: "Big", color: "#B87D10" },
];

function task(id: string, categoryId: string, hours: number, templateId?: string): Task {
  const category = CATEGORIES.find((c) => c.id === categoryId)!;
  return {
    id,
    title: id,
    start: "2026-10-07T10:00:00.000Z",
    duration: hours,
    categoryId,
    categoryName: category.name,
    categoryColor: category.color,
    ...(templateId ? { templateId } : {}),
  };
}

function filters() {
  return {
    year: ref(2026),
    view: ref<AnalyticsView>("monthly"),
    monthRange: ref({ start: 0, end: 11 }),
    weekRange: ref({ start: 1, end: 53 }),
    dailyWeek: ref(41),
  };
}

const realWarn = console.warn;
beforeEach(() => {
  memory.clear();
  setActivePinia(createPinia());
  vi.clearAllMocks();
  // useStats registers onMounted (years for signed-in users); there is no component here.
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("onMounted is called when there is no active component")) return;
    realWarn(...args);
  });
});

describe(`useStats ordering (${TEST_ZONE})`, () => {
  it("guest: hours DESC, then ordinal name, then id; Top category is the first", () => {
    useAuthStore().accessToken = null;
    const store = useTaskStore();
    store.categories = CATEGORIES;
    store.templates = [
      { id: "tpl-b", title: "Standup", duration: 1, categoryId: "c5", categoryName: "Big", categoryColor: "#B87D10" },
      { id: "tpl-a", title: "Review", duration: 1, categoryId: "c5", categoryName: "Big", categoryColor: "#B87D10" },
    ];
    store.tasks = [
      task("t1", "c3", 2),
      task("t2", "c2", 2),
      task("t3", "c9", 2, "tpl-b"),
      task("t4", "c1", 2, "tpl-a"),
      task("t5", "c5", 2, "tpl-gone"), // its template was deleted
    ];
    store.guestDataLoaded = true;

    const scope = effectScope();
    const stats = scope.run(() => useStats().useFilteredStats(filters()))!;
    const snapshot = stats.snapshot.value!;

    expect(snapshot.categories.map((c) => `${c.name}#${c.id}`)).toEqual([
      "Alpha#c1",
      "Alpha#c9",
      "Big#c5",
      "Zeta#c2",
      "beta#c3",
    ]);
    // equal hours, names ordered ordinally: "Deleted template" < "Review" < "Standup"
    expect(snapshot.templates.map((t) => t.name)).toEqual(["Deleted template", "Review", "Standup"]);
    const deleted = snapshot.templates.find((t) => t.deleted)!;
    expect(deleted.categoryName).toBeNull();
    expect(snapshot.templates.find((t) => t.name === "Review")!.categoryName).toBe("Big");
    expect(snapshot.taskCount).toBe(5);
    expect(snapshot.activeDays).toBe(1);
    scope.stop();
  });

  it("signed in: the API breakdown is ordered the same way", async () => {
    useAuthStore().accessToken = "test-token";
    const response: TaskAnalyticsResponse = {
      totalHours: 10,
      timePerCategory: [
        { categoryId: "c3", categoryName: "beta", categoryColor: "#2F7FE0", totalHours: 2 },
        { categoryId: "c2", categoryName: "Zeta", categoryColor: "#DA6A1C", totalHours: 2 },
        { categoryId: "c9", categoryName: "Alpha", categoryColor: "#0E9C8C", totalHours: 2 },
        { categoryId: "c1", categoryName: "Alpha", categoryColor: "#8E55CC", totalHours: 2 },
        { categoryId: "c5", categoryName: "Big", categoryColor: "#B87D10", totalHours: 2 },
      ],
      timePerTemplate: [
        { templateId: "tpl-b", templateTitle: "standup", categoryColor: "#B87D10", totalHours: 1 },
        { templateId: "tpl-a", templateTitle: "Standup", categoryColor: "#B87D10", totalHours: 1 },
        { templateId: "tpl-c", templateTitle: "Planning", categoryColor: "#B87D10", totalHours: 3 },
      ],
      breakdownData: [],
    };
    api.getTaskAnalytics.mockResolvedValue(response);

    const scope = effectScope();
    const stats = scope.run(() => useStats().useFilteredStats(filters()))!;
    await vi.waitFor(() => expect(stats.snapshot.value).not.toBeNull());
    await nextTick();
    const snapshot = stats.snapshot.value!;

    expect(snapshot.categories.map((c) => `${c.name}#${c.id}`)).toEqual([
      "Alpha#c1",
      "Alpha#c9",
      "Big#c5",
      "Zeta#c2",
      "beta#c3",
    ]);
    expect(snapshot.templates.map((t) => t.name)).toEqual(["Planning", "Standup", "standup"]);
    scope.stop();
  });
});
