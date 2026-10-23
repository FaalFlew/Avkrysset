/**
 * The task list on phones / in narrow cards: semantic list markup (day headings + a list of task
 * cards, no restyled table), an organization task's grouping shown ONCE (tagged "Organization"),
 * the template only when set, the creator, and cards that open their task. Plus the layout rule
 * (paper → table; measured card width; phone breakpoint before the first measurement).
 * `*.web.spec.ts`: compiled for the client (vitest.config.ts testTransformMode), see fakeRenderer.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive } from "vue";
import type { Task } from "@/types";

vi.mock("@/composables/usePrintMode", async () => {
  const { reactive } = await import("vue");
  return { printState: reactive({ active: false, printedAt: 0 }) };
});
// A phone: below the 768px breakpoint (no ResizeObserver in node, so the breakpoint decides).
vi.mock("@/composables/useMediaQuery", async () => {
  const { ref } = await import("vue");
  const breakpoints = {
    isMobile: ref(true),
    isTablet: ref(false),
    isDesktop: ref(false),
    isWide: ref(false),
    isCoarse: ref(true),
    prefersReducedMotion: ref(false),
  };
  return { useBreakpoint: () => breakpoints, useMediaQuery: () => ref(false) };
});

if (typeof globalThis.HTMLElement === "undefined") Object.assign(globalThis, { HTMLElement: class {} });

import TaskList from "../TaskList.vue";
import { CARD_LAYOUT_MAX_WIDTH, taskListLayout } from "../taskListView";
import { buildTaskListRows, type TaskListRow } from "@/lib/taskList";
import { addDays, combineDateAndTime, formatDate } from "@/lib/datetime";
import { TEST_ZONE } from "@/lib/__tests__/tz";
import { byClass, byTag, fakeFocus, findAll, fire, hasClass, mountFake, textOf } from "./fakeRenderer";

const DAY = "2026-10-14";
const WORK = { id: "c-work", name: "Work", color: "#2F7FE0" };

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
    categories: [WORK, { id: "org-1", name: "Acme Ops", color: "#0E9C8C" }],
    templates: [{ id: "tpl-1", title: "Morning run" }],
    currentUserId: "me",
  });
}

function mountCards(rows: TaskListRow[]) {
  const state = reactive({ rows });
  const opened: string[] = [];
  const mounted = mountFake(
    defineComponent({
      setup: () => () =>
        h(TaskList, {
          rows: state.rows,
          scopeLabel: "Week 42, 2026",
          category: null,
          onOpen: (row: TaskListRow) => opened.push(row.id),
        }),
    })
  );
  return { ...mounted, opened };
}

describe(`TaskList cards (${TEST_ZONE})`, () => {
  const rows = () =>
    rowsOf([
      task("Deep work", DAY, "09:00", 1.5, { templateId: "tpl-1" }),
      task("Night shift", DAY, "22:30", 3),
      task("Ops review", addDays(DAY, 1), "10:00", 2, {
        organizationId: "org-1",
        organizationName: "Acme Ops",
        categoryId: "their-private-cat",
        categoryName: "B-Private",
        createdBy: { userId: "admin", displayName: "Ada Admin" },
      }),
    ]);

  it("renders semantic list markup: a heading per day and a list of task cards (no table)", () => {
    const { container, unmount } = mountCards(rows());
    expect(findAll(container, byTag("table"))).toHaveLength(0);
    expect(findAll(container, byClass("task-list"))[0]!.props["data-layout"]).toBe("cards");

    const headings = findAll(container, byTag("h3"));
    expect(headings.map(textOf)).toEqual([
      `${formatDate(DAY, "full")} , 2 tasks · 4h 30m`,
      `${formatDate(addDays(DAY, 1), "full")} , 1 task · 2h`,
    ]);
    const lists = findAll(container, byTag("ul")).filter((ul) => hasClass(ul, "cards"));
    expect(lists).toHaveLength(2);
    expect(lists.every((ul) => ul.props.role === "list")).toBe(true);
    const items = findAll(container, byClass("card"));
    expect(items.map((li) => li.tag)).toEqual(["li", "li", "li"]);
    // Each day section is labelled by its heading.
    const sections = findAll(container, byClass("day"));
    expect(sections.map((s) => s.props["aria-labelledby"])).toEqual(headings.map((h3) => h3.props.id));
    unmount();
  });

  it("shows an organization task's grouping once, tagged, and the template only when set", () => {
    const { container, unmount } = mountCards(rows());
    const [deep, night, ops] = findAll(container, byClass("card"));
    const opsText = textOf(ops!);
    expect(opsText.match(/Acme Ops/g)).toHaveLength(1);
    expect(textOf(findAll(ops!, byClass("org-tag"))[0]!)).toBe("Organization");
    expect(opsText).not.toContain("B-Private");
    expect(opsText).toContain("Created by Ada Admin");

    expect(textOf(findAll(deep!, byClass("card__meta"))[0]!)).toBe("Work Template: Morning run Created by You");
    expect(findAll(night!, byClass("meta--template"))).toHaveLength(0);
    expect(textOf(findAll(night!, byClass("end-marker"))[0]!)).toBe("+1d");
    expect(textOf(findAll(container, byClass("cards-total"))[0]!)).toBe("Total: 3 tasks 6h 30m");
    unmount();
  });

  it("a tap on a card or its title button opens the task; Show more focuses the first new card", async () => {
    const many: Task[] = [];
    for (let i = 0; i < 130; i++) many.push(task(`t${String(i).padStart(3, "0")}`, addDays(DAY, Math.floor(i / 10)), `${String(8 + (i % 10)).padStart(2, "0")}:00`, 0.5));
    const { container, opened, unmount } = mountCards(rowsOf(many));
    const cards = findAll(container, byClass("card"));
    expect(cards).toHaveLength(100);
    await fire(cards[3]!, "click");
    await fire(findAll(cards[5]!, byClass("title-button"))[0]!, "click");
    expect(opened).toEqual(["t003", "t005"]);

    const more = findAll(container, byTag("button")).find((b) => textOf(b) === "Show 30 more")!;
    await fire(more, "click");
    expect(findAll(container, byClass("card"))).toHaveLength(130);
    expect(textOf(fakeFocus.current!)).toBe("t100");
    unmount();
  });
});

describe("task list layout rule", () => {
  it("paper → table; measured card width decides on screen; before measuring, the phone breakpoint", () => {
    expect(taskListLayout({ printing: true, cardWidth: 320, isMobile: true })).toBe("table");
    expect(taskListLayout({ printing: false, cardWidth: CARD_LAYOUT_MAX_WIDTH - 1, isMobile: false })).toBe("cards");
    expect(taskListLayout({ printing: false, cardWidth: CARD_LAYOUT_MAX_WIDTH, isMobile: true })).toBe("table");
    expect(taskListLayout({ printing: false, cardWidth: null, isMobile: true })).toBe("cards");
    expect(taskListLayout({ printing: false, cardWidth: null, isMobile: false })).toBe("table");
    expect(taskListLayout({ printing: false, cardWidth: 0, isMobile: true })).toBe("cards"); // hidden: not measured
  });
});
