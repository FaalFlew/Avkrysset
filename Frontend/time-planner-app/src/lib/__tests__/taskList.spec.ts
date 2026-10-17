/**
 * The analytics task list rows (docs/plans/analytics-task-list.md): order shared with the server
 * (start, then ordinal title, then id), day groups by the LOCAL date of the start with subtotals,
 * search + category filter, paging, "You" as creator, and the analytics category mapping
 * (organization tasks under the organization, colored by the analytics entry). Runs in every
 * test zone; the DST cases for Europe/Oslo (2026-W43/W44) run in that zone only.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import {
  CREATED_BY_YOU,
  DELETED_TEMPLATE,
  NO_FILTER,
  buildTaskListRows,
  compareTaskListRows,
  filterTaskListRows,
  groupTaskListRows,
  isFiltered,
  pageTaskListDays,
  taskListCategories,
  taskListTotals,
  toTaskListRow,
  type TaskListContext,
} from "../taskList";
import { analyticsRange } from "../analyticsBuckets";
import { addDays, combineDateAndTime, endInstant, isInRange } from "../datetime";
import { formatEndDayMarker } from "../plannerFormat";
import { TEST_ZONE, assertZoneApplied } from "./tz";

const WORK = { id: "c-work", name: "Work", color: "#2F7FE0" };
const GYM = { id: "c-gym", name: "Gym", color: "#3D9A50" };

function task(id: string, start: string, hours: number, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    start,
    duration: hours,
    categoryId: WORK.id,
    categoryName: WORK.name,
    categoryColor: WORK.color,
    ...patch,
  };
}

/** A local wall-clock start in the test zone. */
const at = (day: string, time: string) => combineDateAndTime(day, time);

const ctx = (patch: Partial<TaskListContext> = {}): TaskListContext => ({
  categories: [WORK, GYM],
  templates: [{ id: "tpl-1", title: "Morning run" }],
  currentUserId: null,
  ...patch,
});

describe(`task list rows (${TEST_ZONE})`, () => {
  it("runs in the configured zone", () => {
    assertZoneApplied();
  });

  it("orders by start, then title (ordinal, not locale), then id (ordinal)", () => {
    const nine = at("2026-10-14", "09:00");
    const ten = at("2026-10-14", "10:00");
    const rows = buildTaskListRows(
      [
        task("x", ten, 1, { title: "beta" }),
        task("y", nine, 1, { title: "Zeta" }),
        task("b", ten, 1, { title: "Beta" }),
        task("a", ten, 1, { title: "Beta" }),
        task("0", ten, 1, { title: "beta" }),
        task("z", ten, 1, { title: "Äpple" }),
        task("w", ten, 1, { title: "Zebra" }),
      ],
      ctx()
    );
    // "B" (66) < "Z" (90) < "b" (98) < "Ä" (196): plain `<`, like .NET StringComparer.Ordinal
    expect(rows.map((r) => `${r.title}#${r.id}`)).toEqual([
      "Zeta#y",
      "Beta#a",
      "Beta#b",
      "Zebra#w",
      "beta#0",
      "beta#x",
      "Äpple#z",
    ]);
    expect(compareTaskListRows(rows[1]!, rows[1]!)).toBe(0);
  });

  it("groups by the local date of the start, with subtotals; the grand total is the sum", () => {
    const rows = buildTaskListRows(
      [
        task("late", at("2026-10-14", "23:30"), 2), // runs into Oct 15, still an Oct 14 task
        task("early", at("2026-10-14", "07:00"), 1.5),
        task("next", at("2026-10-15", "00:15"), 0.25),
        task("later", at("2026-10-17", "12:00"), 3),
      ],
      ctx()
    );
    const days = groupTaskListRows(rows);
    expect(days.map((d) => [d.dateKey, d.rows.map((r) => r.id), d.count, d.hours])).toEqual([
      ["2026-10-14", ["early", "late"], 2, 3.5],
      ["2026-10-15", ["next"], 1, 0.25],
      ["2026-10-17", ["later"], 1, 3],
    ]);
    const totals = taskListTotals(rows);
    expect(totals).toEqual({ count: 4, hours: 6.75 });
    expect(days.reduce((sum, d) => sum + d.hours, 0)).toBe(totals.hours);
    expect(days.reduce((sum, d) => sum + d.count, 0)).toBe(totals.count);

    const late = rows.find((r) => r.id === "late")!;
    expect(late.end).toBe(endInstant(late.start, 2));
    expect(formatEndDayMarker(late.start, late.hours)).toBe("+1d");
    expect(formatEndDayMarker(rows.find((r) => r.id === "early")!.start, 1.5)).toBe("");
  });

  it("a task ending exactly at midnight gets no +1d marker", () => {
    const row = toTaskListRow(task("t", at("2026-10-14", "23:00"), 1), ctx());
    expect(formatEndDayMarker(row.start, row.hours)).toBe("");
    expect(row.dateKey).toBe("2026-10-14");
  });

  it.runIf(TEST_ZONE === "Europe/Oslo")("Europe/Oslo W43/W44 2026: DST end day groups and +1d", () => {
    // Clocks go back on Sunday 2026-10-25 03:00 CEST → 02:00 CET (a 25-hour day).
    const w43 = analyticsRange({
      view: "daily",
      year: 2026,
      monthRange: { start: 0, end: 11 },
      weekRange: { start: 1, end: 53 },
      dailyWeek: 43,
    });
    expect(w43).toEqual({ start: "2026-10-18T22:00:00.000Z", end: "2026-10-25T23:00:00.000Z" });

    const tasks = [
      task("before-week", "2026-10-18T21:59:00.000Z", 1), // Sun Oct 18 23:59 CEST (W42)
      task("monday-0000", "2026-10-18T22:00:00.000Z", 1), // Mon Oct 19 00:00 CEST
      task("first-0230", "2026-10-25T00:30:00.000Z", 0.5), // 02:30 CEST (first occurrence)
      task("second-0230", "2026-10-25T01:30:00.000Z", 0.5), // 02:30 CET (second occurrence)
      task("sat-2300", "2026-10-24T21:00:00.000Z", 3), // Sat 23:00 CEST → Sun 02:00 CEST: +1d
      task("sun-2200", "2026-10-25T21:00:00.000Z", 2), // Sun 22:00 CET → Mon 00:00: ends at midnight
      task("sun-2359", "2026-10-25T22:59:00.000Z", 0.25), // Sun 23:59 CET → Mon 00:14: +1d
      task("w44-monday", "2026-10-25T23:00:00.000Z", 1), // Mon Oct 26 00:00 CET (W44)
    ];
    const rows = buildTaskListRows(
      tasks.filter((t) => isInRange(t.start, w43)),
      ctx()
    );
    const days = groupTaskListRows(rows);
    expect(days.map((d) => [d.dateKey, d.rows.map((r) => r.id)])).toEqual([
      ["2026-10-19", ["monday-0000"]],
      ["2026-10-24", ["sat-2300"]],
      ["2026-10-25", ["first-0230", "second-0230", "sun-2200", "sun-2359"]],
    ]);
    const marker = (id: string) => {
      const r = rows.find((row) => row.id === id)!;
      return formatEndDayMarker(r.start, r.hours);
    };
    expect(marker("sat-2300")).toBe("+1d");
    expect(marker("sun-2200")).toBe("");
    expect(marker("sun-2359")).toBe("+1d");
    expect(marker("first-0230")).toBe("");

    // W44 starts with the Monday task.
    const w44 = analyticsRange({
      view: "daily",
      year: 2026,
      monthRange: { start: 0, end: 11 },
      weekRange: { start: 1, end: 53 },
      dailyWeek: 44,
    });
    expect(tasks.filter((t) => isInRange(t.start, w44)).map((t) => t.id)).toEqual(["w44-monday"]);
  });

  it("search matches the shown title, case-insensitively; the category filter uses the analytics id", () => {
    const day = "2026-10-14";
    const rows = buildTaskListRows(
      [
        task("a", at(day, "08:00"), 1, { title: "Deep WORK" }),
        task("b", at(day, "09:00"), 1, { title: "Standup", categoryId: GYM.id }),
        task("c", at(day, "10:00"), 1, { title: "   " }), // blank → "Untitled task"
        task("d", at(day, "11:00"), 1, { title: "Customer call", organizationId: "org-1", organizationName: "Acme" }),
      ],
      ctx()
    );
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(filterTaskListRows(rows, NO_FILTER)).toHaveLength(4);
    expect(filterTaskListRows(rows, { query: "  deep work ", categoryId: null }).map((r) => r.id)).toEqual(["a"]);
    expect(filterTaskListRows(rows, { query: "untitled", categoryId: null }).map((r) => r.id)).toEqual(["c"]);
    expect(filterTaskListRows(rows, { query: "", categoryId: GYM.id }).map((r) => r.id)).toEqual(["b"]);
    expect(filterTaskListRows(rows, { query: "", categoryId: "org-1" }).map((r) => r.id)).toEqual(["d"]);
    expect(filterTaskListRows(rows, { query: "call", categoryId: WORK.id }).map((r) => r.id)).toEqual([]);
    expect(filterTaskListRows(rows, { query: "e", categoryId: WORK.id }).map((r) => r.id)).toEqual(["a", "c"]);
    expect(isFiltered({ query: " ", categoryId: null })).toBe(false);
    expect(isFiltered({ query: "x", categoryId: null })).toBe(true);
    expect(isFiltered({ query: "", categoryId: "c" })).toBe(true);
  });

  it("pages 100 rows at a time across days; a cut day keeps its full subtotal; Infinity shows all", () => {
    const tasks: Task[] = [];
    for (let i = 0; i < 250; i++) {
      const day = addDays("2026-10-05", Math.floor(i / 60)); // 60 tasks a day
      const minutes = (i % 60) * 15;
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      tasks.push(task(`t${String(i).padStart(3, "0")}`, at(day, time), 0.25));
    }
    const days = groupTaskListRows(buildTaskListRows(tasks, ctx()));
    expect(days.map((d) => d.count)).toEqual([60, 60, 60, 60, 10]);

    const first = pageTaskListDays(days, 100);
    expect(first.map((d) => [d.visibleRows.length, d.count])).toEqual([
      [60, 60],
      [40, 60],
    ]);
    expect(first[1]!.hours).toBe(15); // the whole day, not just the 40 visible rows

    const second = pageTaskListDays(days, 200);
    expect(second.reduce((n, d) => n + d.visibleRows.length, 0)).toBe(200);

    const all = pageTaskListDays(days, Infinity);
    expect(all.reduce((n, d) => n + d.visibleRows.length, 0)).toBe(250);
    expect(all).toHaveLength(5);
  });

  it('creator: "You" for personal and guest tasks and my org tasks; else the display name', () => {
    const start = at("2026-10-14", "09:00");
    const org = { organizationId: "org-1", organizationName: "Acme" };
    const mine = toTaskListRow(task("p", start, 1, { createdBy: { userId: "ME", displayName: "Me Myself" } }), ctx());
    expect(mine.createdBy).toBe(CREATED_BY_YOU);
    expect(mine.createdByMe).toBe(true);

    const guest = toTaskListRow(task("g", start, 1), ctx({ currentUserId: null }));
    expect(guest.createdBy).toBe("You");

    const myOrgTask = toTaskListRow(
      task("o1", start, 1, { ...org, createdBy: { userId: "ME", displayName: "Me Myself" } }),
      ctx({ currentUserId: "me" }) // ids compare case-insensitively
    );
    expect(myOrgTask.createdBy).toBe("You");

    const assigned = toTaskListRow(
      task("o2", start, 1, {
        ...org,
        createdBy: { userId: "admin", displayName: "Ada Admin" },
        assignees: [
          { userId: "u2", displayName: "kari", email: "kari@example.com" },
          { userId: "me", displayName: "Me Myself", email: "me@example.com" },
          { userId: "u3", displayName: "", email: "ola@example.com" },
        ],
      }),
      ctx({ currentUserId: "me" })
    );
    expect(assigned.createdBy).toBe("Ada Admin");
    expect(assigned.createdByMe).toBe(false);
    expect(assigned.assigneeNames).toEqual(["Me Myself", "kari", "ola@example.com"]); // ordinal

    // Unknown user (id not resolved yet): an org task shows the creator's name.
    const unknownMe = toTaskListRow(
      task("o3", start, 1, { ...org, createdBy: { userId: "me", displayName: "Me Myself" } }),
      ctx({ currentUserId: null })
    );
    expect(unknownMe.createdBy).toBe("Me Myself");
  });

  it("categories: personal tasks by category, org tasks under the organization with the analytics color", () => {
    const start = at("2026-10-14", "09:00");
    const analytics = [
      { id: WORK.id, name: "Work", color: "#111111" },
      { id: "org-1", name: "Acme", color: "#0E9C8C" },
    ];
    const personal = toTaskListRow(task("p", start, 1, { categoryColor: "#999999" }), ctx({ categories: analytics }));
    expect(personal.category).toEqual({ id: WORK.id, name: "Work", color: "#111111" });
    expect(personal.organizationName).toBeNull();

    const orgTask = task("o", start, 1, {
      organizationId: "org-1",
      organizationName: " Acme ",
      categoryId: "their-cat",
      categoryName: "Sales",
      categoryColor: "#AA3355",
      templateId: "tpl-1",
    });
    const orgRow = toTaskListRow(orgTask, ctx({ categories: analytics }));
    expect(orgRow.category).toEqual({ id: "org-1", name: "Acme", color: "#0E9C8C" });
    expect(orgRow.organizationName).toBe("Acme");
    expect(orgRow.templateTitle).toBeNull(); // org tasks count as "without template"

    // Not in the analytics data (yet): the org's name and a neutral color, never the creator's category.
    const unknownOrg = toTaskListRow(orgTask, ctx({ categories: [] }));
    expect(unknownOrg.category).toEqual({ id: "org-1", name: "Acme", color: null });

    // A personal category the analytics data doesn't list: my category, then the task's own fields.
    const own = toTaskListRow(
      task("q", start, 1, { categoryId: "c-x", categoryName: "Old name", categoryColor: "#123456" }),
      ctx({ categories: [], categoryById: (id) => (id === "c-x" ? { name: "Renamed", color: "#654321" } : undefined) })
    );
    expect(own.category).toEqual({ id: "c-x", name: "Renamed", color: "#654321" });
    const bare = toTaskListRow(task("r", start, 1, { categoryId: "c-y", categoryName: "", categoryColor: "" }), ctx({ categories: [] }));
    expect(bare.category).toEqual({ id: "c-y", name: "Unknown category", color: null });
  });

  it('templates: the title, "Deleted template" when it is gone, null without one', () => {
    const start = at("2026-10-14", "09:00");
    expect(toTaskListRow(task("a", start, 1, { templateId: "tpl-1" }), ctx()).templateTitle).toBe("Morning run");
    const gone = toTaskListRow(task("b", start, 1, { templateId: "tpl-gone" }), ctx());
    expect(gone.templateTitle).toBe(DELETED_TEMPLATE);
    expect(gone.templateDeleted).toBe(true);
    expect(toTaskListRow(task("c", start, 1), ctx()).templateTitle).toBeNull();
  });

  it("chips: the categories of the rows, ordered like the analytics breakdown", () => {
    const day = "2026-10-14";
    const rows = buildTaskListRows(
      [
        task("a", at(day, "08:00"), 1),
        task("b", at(day, "09:00"), 2, { categoryId: GYM.id }),
        task("c", at(day, "11:00"), 1),
        task("d", at(day, "12:00"), 1, { organizationId: "org-1", organizationName: "Acme" }),
      ],
      ctx()
    );
    expect(taskListCategories(rows).map((c) => [c.name, c.count, c.hours])).toEqual([
      ["Gym", 1, 2],
      ["Work", 2, 2],
      ["Acme", 1, 1],
    ]);
  });
});
