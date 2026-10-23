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
import { byClass, byTag, closest, fakeFocus, findAll, fire, hasClass, mountFake, textOf, type FakeNode } from "./fakeRenderer";
import { formatDuration } from "@/lib/format";

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

interface ListState {
  rows: TaskListRow[];
  loading: boolean;
  refetching: boolean;
  dim: boolean | undefined;
  error: string | null;
  category: string | null;
  scopeLabel: string;
}

/** Mount TaskList with reactive props and a log of its events. */
function mountList(initial: Partial<ListState>) {
  const state = reactive<ListState>({
    rows: [],
    loading: false,
    refetching: false,
    dim: undefined,
    error: null,
    category: null,
    scopeLabel: "Week 42, 2026",
    ...initial,
  });
  const events = { open: [] as TaskListRow[], retry: 0, category: [] as (string | null)[] };
  const Host = defineComponent({
    setup() {
      return () =>
        h(TaskList, {
          rows: state.rows,
          loading: state.loading,
          refetching: state.refetching,
          dim: state.dim,
          error: state.error,
          scopeLabel: state.scopeLabel,
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

const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};
const fmt = (n: number) => new Intl.NumberFormat().format(n);
const statusTexts = (root: FakeNode) => findAll(root, (n) => n.props.role === "status").map(textOf);

beforeEach(() => {
  (printState as { active: boolean }).active = false;
  chartOptions.current = null;
  fakeFocus.current = null;
});

describe(`TaskList (${TEST_ZONE})`, () => {
  it("groups by day with subtotals, a grand total, +1d markers and 'You'", () => {
    const { container, unmount } = mountList({ rows: SAMPLE() });
    const dayHeaders = findAll(container, byClass("day-row__cell"));
    expect(dayHeaders.map(textOf)).toEqual([
      `${formatDate(DAY, "full")} , 2 tasks · 4h 30m`,
      `${formatDate(addDays(DAY, 1), "full")} , 2 tasks · 45m`,
    ]);
    expect(dayHeaders.every((th) => th.props.scope === "rowgroup")).toBe(true);
    expect(rowTitles(container)).toEqual(["Deep work", "Night shift", "Run", "Standup"]);

    const night = taskRows(container)[1]!;
    expect(textOf(findAll(night, byClass("end-marker"))[0]!)).toBe("+1d");
    expect(textOf(findAll(night, byClass("sr-only"))[0]!)).toBe(", ends the next day");
    expect(findAll(taskRows(container)[0]!, byClass("end-marker"))).toHaveLength(0);

    const cells = (tr: FakeNode, cls: string) => textOf(findAll(tr, byClass(cls))[0]!);
    expect(cells(taskRows(container)[0]!, "cell-template")).toBe("Morning run");
    expect(cells(taskRows(container)[2]!, "cell-template")).toBe("Deleted template");
    expect(cells(taskRows(container)[3]!, "cell-template")).toBe("—");
    expect(cells(taskRows(container)[2]!, "cell-category")).toBe("Gym");
    expect(cells(taskRows(container)[0]!, "cell-created")).toBe("You");
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
    expect(textOf(findAll(assigned, byClass("cell-created"))[0]!)).toBe("Ada Admin");
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
    // Keyboard users continue where the new rows start.
    expect(textOf(fakeFocus.current!)).toBe("t100");
    expect(hasClass(fakeFocus.current!, "title-button")).toBe(true);
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

  it("groups large counts like the KPIs (5,003); paper stops at 5,000 rows with the PDF's note", async () => {
    const tasks: Task[] = [];
    for (let i = 0; i < 5003; i++) {
      const minutes = 8 * 60 + (i % 20) * 30;
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      tasks.push(task(`t${String(i).padStart(4, "0")}`, addDays("2026-01-05", Math.floor(i / 20)), time, 0.25));
    }
    const rows = rowsOf(tasks);
    const total = formatDuration(5003 * 0.25);

    const onScreen = mountList({ rows });
    expect(textOf(findAll(onScreen.container, byClass("ui-card__caption"))[0]!)).toBe(`${fmt(5003)} tasks · ${total}`);
    expect(textOf(findAll(onScreen.container, byClass("more__status"))[0]!)).toBe(`Showing 100 of ${fmt(5003)} tasks`);
    expect(textOf(findAll(onScreen.container, byClass("total-row"))[0]!)).toBe(`Total ${total} ${fmt(5003)} tasks`);
    expect(findAll(onScreen.container, byClass("chip")).map(textOf)).toEqual(["All", `Work ${fmt(5003)}`]);
    expect(fmt(5003)).not.toBe("5003"); // the test locale groups thousands
    onScreen.unmount();

    (printState as { active: boolean }).active = true;
    const printed = mountList({ rows });
    expect(taskRows(printed.container)).toHaveLength(5000);
    expect(textOf(findAll(printed.container, byClass("print-cap-note"))[0]!)).toBe(
      `Showing the first ${fmt(5000)} of ${fmt(5003)} tasks — use Task list (CSV) for the complete list.`
    );
    // The grand total still covers every task (like the PDF's).
    expect(textOf(findAll(printed.container, byClass("total-row"))[0]!)).toBe(`Total ${total} ${fmt(5003)} tasks`);
    printed.unmount();

    const small = mountList({ rows: SAMPLE() });
    expect(findAll(small.container, byClass("print-cap-note"))).toHaveLength(0);
    small.unmount();
  });

  it("after Retry, focus goes to the first task once loaded (never to <body>)", async () => {
    const { container, state, unmount } = mountList({ error: "Network Error" });
    await fire(buttonByText(container, "Try again"), "click");
    state.error = "Still offline"; // the retry failed: focus stays on "Try again"
    await settle();
    expect(fakeFocus.current).toBeNull();

    state.error = null;
    state.rows = SAMPLE();
    await settle();
    expect(hasClass(fakeFocus.current!, "title-button")).toBe(true);
    expect(textOf(fakeFocus.current!)).toBe("Deep work");
    unmount();

    // Nothing in the range: the card itself (labelled "Tasks") takes focus.
    const empty = mountList({ error: "Network Error" });
    await fire(buttonByText(empty.container, "Try again"), "click");
    empty.state.error = null;
    await settle();
    expect(fakeFocus.current?.tag).toBe("section");
    expect(hasClass(fakeFocus.current!, "task-list")).toBe(true);
    empty.unmount();
  });

  it("while a new range loads, the captions describe the rows on screen and say Updating…", async () => {
    const { container, state, unmount } = mountList({ rows: SAMPLE(), refetching: true, scopeLabel: "Week 41, 2026" });
    const caption = () => textOf(findAll(container, byClass("ui-card__caption"))[0]!);
    const tableCaption = () => textOf(findAll(container, byTag("caption"))[0]!);
    const body = () => findAll(container, byClass("task-list__body"))[0]!;
    expect(caption()).toBe("Updating… still showing Week 41, 2026");
    expect(tableCaption()).toBe("Tasks, Week 41, 2026, updating");
    expect(statusTexts(container)).toContain("Updating tasks");
    expect(hasClass(body(), "is-refetching")).toBe(true);

    state.dim = false; // the whole page is dimmed already
    await settle();
    expect(hasClass(body(), "is-refetching")).toBe(false);

    state.refetching = false;
    state.scopeLabel = "Week 42, 2026";
    await settle();
    expect(caption()).toBe("4 tasks · 5h 15m");
    expect(tableCaption()).toBe("Tasks, Week 42, 2026");
    expect(statusTexts(container)).not.toContain("Updating tasks");
    unmount();
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
