/**
 * The "Tasks" card of the analytics page, rendered with a tiny in-memory renderer (no DOM in the
 * test environment): day groups with subtotals and a grand total, "+1d" end markers, the
 * Organization column only when needed, "You" as creator, search, category chips, paging by 100
 * (print shows every row), row/Enter activation, the empty/loading/error states — and the donut:
 * its legend items and segments pick the category filter.
 * `*.web.spec.ts`: compiled for the client (vitest.config.ts testTransformMode), see fakeRenderer.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive } from "vue";
import type { Task } from "@/types";

vi.mock("@/composables/usePrintMode", async () => {
  const { reactive } = await import("vue");
  return { printState: reactive({ active: false, printedAt: 0 }) };
});
// Chart.js needs a canvas: the stub keeps the options so a test can "click" a segment.
const chartOptions = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("vue-chartjs", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    Doughnut: defineComponent({
      name: "DoughnutStub",
      props: { data: Object, options: Object },
      setup(props) {
        return () => {
          chartOptions.current = props.options as Record<string, unknown>;
          return h("canvas");
        };
      },
    }),
  };
});

import { printState } from "@/composables/usePrintMode";
import TaskList from "../TaskList.vue";
import CategoryDonut from "../CategoryDonut.vue";
import { buildTaskListRows, type TaskListRow } from "@/lib/taskList";
import { addDays, combineDateAndTime, formatDate } from "@/lib/datetime";
import { TEST_ZONE } from "@/lib/__tests__/tz";
import { byClass, byTag, closest, findAll, fire, hasClass, mountFake, textOf, type FakeNode } from "./fakeRenderer";

// UiIconButton checks `instanceof HTMLElement` for its tooltip anchor.
if (typeof globalThis.HTMLElement === "undefined") Object.assign(globalThis, { HTMLElement: class {} });

const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, String(value)),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
  },
});

const WORK = { id: "c-work", name: "Work", color: "#2F7FE0" };
const GYM = { id: "c-gym", name: "Gym", color: "#3D9A50" };
const DAY = "2026-10-14";

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

function rowsOf(tasks: Task[]): TaskListRow[] {
  return buildTaskListRows(tasks, {
    categories: [WORK, GYM, { id: "org-1", name: "Acme", color: "#0E9C8C" }],
    templates: [{ id: "tpl-1", title: "Morning run" }],
    currentUserId: "me",
  });
}

const SAMPLE = () =>
  rowsOf([
    task("Deep work", DAY, "09:00", 1.5, { templateId: "tpl-1" }),
    task("Night shift", DAY, "22:30", 3), // ends after midnight
    task("Run", addDays(DAY, 1), "07:00", 0.5, { categoryId: GYM.id, templateId: "tpl-gone" }),
    task("Standup", addDays(DAY, 1), "10:00", 0.25),
  ]);

/** Mount TaskList with reactive props and a log of its events. */
function mountList(initial: Partial<{ rows: TaskListRow[]; loading: boolean; error: string | null; category: string | null }>) {
  const state = reactive({ rows: [] as TaskListRow[], loading: false, error: null as string | null, category: null as string | null, ...initial });
  const events = { open: [] as TaskListRow[], retry: 0, category: [] as (string | null)[] };
  const Host = defineComponent({
    setup() {
      return () =>
        h(TaskList, {
          rows: state.rows,
          loading: state.loading,
          error: state.error,
          scopeLabel: "Week 42, 2026",
          category: state.category,
          onOpen: (row: TaskListRow) => events.open.push(row),
          onRetry: () => (events.retry += 1),
          "onUpdate:category": (id: string | null) => {
            events.category.push(id);
            state.category = id;
          },
        });
    },
  });
  const mounted = mountFake(Host);
  return { ...mounted, state, events };
}

const taskRows = (root: FakeNode) => findAll(root, byClass("task-row"));
const rowTitles = (root: FakeNode) => taskRows(root).map((tr) => textOf(findAll(tr, byClass("title-button"))[0]!));
const buttonByText = (root: FakeNode, text: string) =>
  findAll(root, byTag("button")).find((b) => textOf(b) === text || textOf(b).startsWith(text))!;

beforeEach(() => {
  (printState as { active: boolean }).active = false;
  chartOptions.current = null;
});

describe(`TaskList (${TEST_ZONE})`, () => {
  it("groups by day with subtotals, a grand total, +1d markers and 'You'", () => {
    const { container, unmount } = mountList({ rows: SAMPLE() });
    const dayHeaders = findAll(container, byClass("day-row__cell"));
    expect(dayHeaders.map(textOf)).toEqual([
      `${formatDate(DAY, "full")} 2 tasks · 4h 30m`,
      `${formatDate(addDays(DAY, 1), "full")} 2 tasks · 45m`,
    ]);
    expect(dayHeaders.every((th) => th.props.scope === "rowgroup")).toBe(true);
    expect(rowTitles(container)).toEqual(["Deep work", "Night shift", "Run", "Standup"]);

    const night = taskRows(container)[1]!;
    expect(textOf(findAll(night, byClass("end-marker"))[0]!)).toBe("+1d");
    expect(textOf(findAll(night, byClass("sr-only"))[0]!)).toBe(", ends the next day");
    expect(findAll(taskRows(container)[0]!, byClass("end-marker"))).toHaveLength(0);

    const cells = (tr: FakeNode, cls: string) => textOf(findAll(tr, byClass(cls))[0]!);
    expect(cells(taskRows(container)[0]!, "cell-template")).toBe("Template: Morning run");
    expect(cells(taskRows(container)[2]!, "cell-template")).toBe("Template: Deleted template");
    expect(cells(taskRows(container)[3]!, "cell-template")).toBe("Template: —");
    expect(cells(taskRows(container)[2]!, "cell-category")).toBe("Gym");
    expect(cells(taskRows(container)[0]!, "cell-created")).toBe("Created by You");
    expect(cells(taskRows(container)[0]!, "cell-duration")).toBe("1h 30m");

    // No organization tasks → no Organization column.
    expect(findAll(container, byTag("th")).map(textOf)).not.toContain("Organization");
    expect(textOf(findAll(container, byClass("total-row"))[0]!)).toBe("Total 5h 15m 4 tasks");
    // Card caption: the range's totals.
    expect(textOf(findAll(container, byClass("ui-card__caption"))[0]!)).toBe("4 tasks · 5h 15m");
    unmount();
  });

  it("shows the Organization column when any task has one, with the org as category", () => {
    const rows = rowsOf([
      task("Mine", DAY, "09:00", 1),
      task("Assigned", DAY, "11:00", 2, {
        organizationId: "org-1",
        organizationName: "Acme",
        createdBy: { userId: "admin", displayName: "Ada Admin" },
      }),
    ]);
    const { container, unmount } = mountList({ rows });
    expect(findAll(container, byTag("th")).map(textOf)).toContain("Organization");
    const assigned = taskRows(container)[1]!;
    expect(textOf(findAll(assigned, byClass("cell-category"))[0]!)).toBe("Acme");
    expect(textOf(findAll(assigned, byClass("cell-org"))[0]!)).toBe("Acme");
    expect(textOf(findAll(assigned, byClass("cell-created"))[0]!)).toBe("Created by Ada Admin");
    expect(findAll(container, byClass("day-row__cell"))[0]!.props.colspan).toBe(7);
    unmount();
  });

  it("filters by category (chips) and by title search; Clear filters resets both", async () => {
    const { container, events, state, unmount } = mountList({ rows: SAMPLE() });
    const chips = findAll(container, byClass("chip"));
    expect(chips.map(textOf)).toEqual(["All", "Work 3", "Gym 1"]);
    expect(chips[0]!.props["aria-pressed"]).toBe(true);

    await fire(chips[2]!, "click"); // Gym
    expect(events.category).toEqual([GYM.id]);
    expect(rowTitles(container)).toEqual(["Run"]);
    expect(textOf(findAll(container, byClass("total-row"))[0]!)).toBe("Total (filtered) 30m 1 of 4 tasks");
    expect(findAll(container, byClass("chip"))[2]!.props["aria-pressed"]).toBe(true);

    await fire(findAll(container, byClass("chip"))[2]!, "click"); // again: back to all
    expect(state.category).toBeNull();
    expect(rowTitles(container)).toHaveLength(4);

    const input = findAll(container, byTag("input"))[0]!;
    expect(input.props.type).toBe("search");
    await fire(input, "input", { target: { value: "  SHIFT " } });
    expect(rowTitles(container)).toEqual(["Night shift"]);

    await fire(input, "input", { target: { value: "nothing like this" } });
    expect(textOf(container)).toContain("No tasks match");
    await fire(buttonByText(container, "Clear filters"), "click");
    expect(rowTitles(container)).toHaveLength(4);
    unmount();
  });

  it("a category picked outside (the donut) filters the list", async () => {
    const { container, state, unmount } = mountList({ rows: SAMPLE() });
    state.category = WORK.id;
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(rowTitles(container)).toEqual(["Deep work", "Night shift", "Standup"]);
    unmount();
  });

  it("opens a task on a row click and on its title button (Enter/Space click bubbles)", async () => {
    const { container, events, unmount } = mountList({ rows: SAMPLE() });
    await fire(taskRows(container)[2]!, "click");
    const button = findAll(taskRows(container)[0]!, byClass("title-button"))[0]!;
    expect(button.tag).toBe("button");
    expect(closest(button, byTag("th"))!.props.scope).toBe("row");
    await fire(button, "click");
    expect(events.open.map((r) => r.id)).toEqual(["Run", "Deep work"]);
    unmount();
  });

  it("shows 100 rows at a time; Show more adds 100; printing shows every row", async () => {
    const tasks: Task[] = [];
    for (let i = 0; i < 250; i++) {
      const minutes = (i % 48) * 30;
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      tasks.push(task(`t${String(i).padStart(3, "0")}`, addDays("2026-10-05", Math.floor(i / 48)), time, 0.25));
    }
    const { container, unmount } = mountList({ rows: rowsOf(tasks) });
    expect(taskRows(container)).toHaveLength(100);
    expect(textOf(findAll(container, byClass("more__status"))[0]!)).toBe("Showing 100 of 250 tasks");
    // The grand total covers every task, not just the page.
    expect(textOf(findAll(container, byClass("total-row"))[0]!)).toBe("Total 62h 30m 250 tasks");

    await fire(buttonByText(container, "Show 100 more"), "click");
    expect(taskRows(container)).toHaveLength(200);
    await fire(buttonByText(container, "Show 50 more"), "click");
    expect(taskRows(container)).toHaveLength(250);
    expect(findAll(container, byClass("more"))).toHaveLength(0);
    unmount();

    (printState as { active: boolean }).active = true;
    const printed = mountList({ rows: rowsOf(tasks) });
    expect(taskRows(printed.container)).toHaveLength(250);
    expect(findAll(printed.container, byClass("more"))).toHaveLength(0);
    printed.unmount();
  });

  it("loading skeleton, empty range, and error with Retry", async () => {
    const loading = mountList({ loading: true });
    expect(findAll(loading.container, byClass("skeleton"))).toHaveLength(1);
    expect(findAll(loading.container, byClass("task-table"))).toHaveLength(0);
    loading.unmount();

    const empty = mountList({ rows: [] });
    expect(textOf(empty.container)).toContain("No tasks in this range");
    expect(findAll(empty.container, byClass("toolbar"))).toHaveLength(0);
    empty.unmount();

    const failed = mountList({ error: "Network Error" });
    expect(textOf(failed.container)).toContain("Couldn't load the tasks");
    await fire(buttonByText(failed.container, "Try again"), "click");
    expect(failed.events.retry).toBe(1);
    failed.unmount();
  });

  it("is an accessible table: caption, column headers, row headers", () => {
    const { container, unmount } = mountList({ rows: SAMPLE() });
    const table = findAll(container, byTag("table"))[0]!;
    expect(textOf(findAll(table, byTag("caption"))[0]!)).toBe("Tasks, Week 42, 2026");
    const cols = findAll(findAll(table, byTag("thead"))[0]!, byTag("th"));
    expect(cols.every((th) => th.props.scope === "col")).toBe(true);
    expect(cols.map(textOf)).toEqual(["Time", "Duration", "Title", "Category", "Template", "Created by"]);
    expect(hasClass(table, "task-table")).toBe(true);
    unmount();
  });
});

describe("CategoryDonut → task list filter", () => {
  const categories = [
    { id: WORK.id, name: "Work", color: WORK.color, hours: 3, share: 0.75 },
    { id: GYM.id, name: "Gym", color: GYM.color, hours: 1, share: 0.25 },
  ];

  function mountDonut(selectedId: string | null) {
    const selected: string[] = [];
    const mounted = mountFake(
      defineComponent({
        setup: () => () =>
          h(CategoryDonut, {
            categories,
            totalHours: 4,
            scopeLabel: "Week 42, 2026",
            selectedId,
            onSelect: (id: string) => selected.push(id),
          }),
      })
    );
    return { ...mounted, selected };
  }

  it("legend items are toggle buttons that pick the category", async () => {
    const { container, selected, unmount } = mountDonut(GYM.id);
    const items = findAll(container, byClass("legend__item"));
    expect(items.map((b) => b.tag)).toEqual(["button", "button"]);
    expect(items.map((b) => b.props["aria-pressed"])).toEqual([false, true]);
    await fire(items[0]!, "click");
    expect(selected).toEqual([WORK.id]);
    unmount();
  });

  it("clicking a segment picks its category", () => {
    const { selected, unmount } = mountDonut(null);
    const onClick = chartOptions.current!.onClick as (event: unknown, elements: { index: number }[]) => void;
    onClick({}, [{ index: 1 }]);
    onClick({}, []); // empty area: nothing
    expect(selected).toEqual([GYM.id]);
    unmount();
  });
});
