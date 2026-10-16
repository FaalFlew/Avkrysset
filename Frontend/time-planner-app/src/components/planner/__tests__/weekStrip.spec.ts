/**
 * Phone day strip logic: the rendered window of weeks, re-centring while scrolling (and the
 * scroll rebase that hides it), week-number labels at ISO week starts (2026-W53 → 2027-W01),
 * selection vs scrolling, auto-scroll targets and the keyboard model.
 */
import { describe, expect, it } from "vitest";
import {
  STRIP,
  mondayOf,
  moveStripFocus,
  planReveal,
  rebasedScrollLeft,
  recenterStrip,
  shownWeekIndex,
  stripDayAriaLabel,
  stripDayLabel,
  stripScrollTarget,
  stripTabStop,
  stripWeeks,
  stripWindowAround,
  weekIndexOf,
  weekScrollLeft,
  windowContains,
  type StripWindow,
} from "../weekStrip";
import { addDays, diffCalendarDays, formatDate, isoWeekday } from "@/lib/datetime";
import { formatWeekdayMicro } from "@/lib/plannerFormat";
import { assertZoneApplied, TEST_ZONE } from "@/lib/__tests__/tz";

/** One week per screen on a 375px phone. */
const W = 375;

describe(`zone sanity (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });
});

describe("window", () => {
  it("renders 13 whole ISO weeks centred on the selected day's week", () => {
    const win = stripWindowAround("2026-10-17"); // Saturday of 2026-W42 (Oct 12–18)
    expect(win).toEqual({ start: "2026-08-31", weeks: 2 * STRIP.radiusWeeks + 1 });
    expect(isoWeekday(win.start)).toBe(1);
    expect(weekIndexOf(win, "2026-10-17")).toBe(STRIP.radiusWeeks);
    // Every day of the week gives the same window.
    expect(stripWindowAround("2026-10-12")).toEqual(win);
    expect(stripWindowAround("2026-10-18")).toEqual(win);
  });

  it("lists consecutive days with no gaps, Monday first, and a modest DOM (91 pills)", () => {
    const win = stripWindowAround("2026-12-30");
    const weeks = stripWeeks(win);
    const days = weeks.flatMap((w) => w.days.map((d) => d.key));
    expect(weeks).toHaveLength(13);
    expect(days).toHaveLength(91);
    days.forEach((day, i) => expect(day).toBe(addDays(win.start, i)));
    for (const week of weeks) expect(isoWeekday(week.monday)).toBe(1);
    const day = weeks[6]!.days[2]!;
    expect(day).toEqual({
      key: "2026-12-30",
      weekday: formatWeekdayMicro("2026-12-30"),
      date: "30",
      label: stripDayLabel("2026-12-30"),
    });
  });

  it("knows which days are rendered (half-open: the Monday after the last week is not)", () => {
    const win = stripWindowAround("2026-10-17");
    expect(windowContains(win, win.start)).toBe(true);
    expect(windowContains(win, addDays(win.start, -1))).toBe(false);
    expect(windowContains(win, addDays(win.start, 7 * win.weeks - 1))).toBe(true);
    expect(windowContains(win, addDays(win.start, 7 * win.weeks))).toBe(false);
    expect(weekIndexOf(win, addDays(win.start, -1))).toBe(-1);
  });
});

describe("week-number labels", () => {
  it("mark each Monday with its ISO week: 2026-W52, W53, then 2027-W1", () => {
    const weeks = stripWeeks(stripWindowAround("2027-01-01"));
    const byMonday = Object.fromEntries(weeks.map((w) => [w.monday, w]));
    expect(byMonday["2026-12-21"]).toMatchObject({ label: "W52", week: { isoYear: 2026, week: 52 } });
    expect(byMonday["2026-12-28"]).toMatchObject({
      label: "W53",
      ariaLabel: "Week 53",
      week: { isoYear: 2026, week: 53 },
    });
    expect(byMonday["2027-01-04"]).toMatchObject({
      label: "W1",
      ariaLabel: "Week 1",
      week: { isoYear: 2027, week: 1 },
    });
    // New Year's Day 2027 sits in the W53 group, not a W1 group.
    expect(byMonday["2026-12-28"]!.days.map((d) => d.key)).toContain("2027-01-01");
  });

  it("number consecutive weeks without gaps or repeats across the year boundary", () => {
    const labels = stripWeeks(stripWindowAround("2027-01-01")).map((w) => w.label);
    expect(labels).toEqual(["W47", "W48", "W49", "W50", "W51", "W52", "W53", "W1", "W2", "W3", "W4", "W5", "W6"]);
    // 2026-W01 starts in December 2025.
    const start2026 = stripWeeks(stripWindowAround("2026-01-01")).find((w) => w.week.week === 1)!;
    expect(start2026).toMatchObject({ monday: "2025-12-29", week: { isoYear: 2026, week: 1 } });
  });

  it("give every pill a full date label with its week, plus today / has tasks", () => {
    expect(stripDayLabel("2026-10-12")).toBe(`${formatDate("2026-10-12", "full")}, week 42`);
    expect(stripDayLabel("2027-01-01")).toBe(`${formatDate("2027-01-01", "full")}, week 53`);
    expect(stripDayLabel("2027-01-04")).toBe(`${formatDate("2027-01-04", "full")}, week 1`);
    const base = stripDayLabel("2026-10-17");
    expect(stripDayAriaLabel(base, false, false)).toBe(base);
    expect(stripDayAriaLabel(base, true, true)).toBe(`${base}, today, has tasks`);
    expect(stripDayAriaLabel(base, false, true)).toBe(`${base}, has tasks`);
  });
});

describe("re-centring while scrolling", () => {
  const win = stripWindowAround("2026-10-17"); // start 2026-08-31, centre index 6

  it("leaves the window alone while the shown week is 3+ weeks from both ends", () => {
    for (const index of [3, 4, 5, 6, 7, 8, 9]) expect(recenterStrip(win, index), `index ${index}`).toBeNull();
  });

  it("near the start: prepends weeks, keeps the shown week, and pushes scrollLeft right", () => {
    const shownMonday = addDays(win.start, 7 * 2);
    const next = recenterStrip(win, 2)!;
    expect(next.shownIndex).toBe(6);
    expect(next.window.weeks).toBe(win.weeks); // the DOM does not grow
    expect(addDays(next.window.start, 7 * next.shownIndex)).toBe(shownMonday);
    expect(diffCalendarDays(win.start, next.window.start)).toBe(28); // 4 weeks prepended
    expect(rebasedScrollLeft(2 * W, W, win, next.window)).toBe(6 * W);
    // A partly scrolled position keeps its offset inside the week.
    expect(rebasedScrollLeft(2 * W + 10.5, W, win, next.window)).toBe(6 * W + 10.5);
  });

  it("near the end: drops weeks at the front and pulls scrollLeft left", () => {
    const next = recenterStrip(win, 11)!;
    expect(next.shownIndex).toBe(6);
    expect(addDays(next.window.start, 7 * 6)).toBe(addDays(win.start, 7 * 11));
    expect(rebasedScrollLeft(11 * W, W, win, next.window)).toBe(6 * W);
    expect(recenterStrip(win, 12)!.window.start).toBe(addDays(win.start, 7 * 6));
    expect(recenterStrip(win, 0)!.window.start).toBe(addDays(win.start, -7 * 6));
  });

  it("lets a user scroll through many weeks: the same week stays on screen at every re-centre", () => {
    let current: StripWindow = stripWindowAround("2026-12-02");
    let scrollLeft = 6 * W;
    let shownMonday = addDays(current.start, 7 * 6);
    // Fling to the far right end and settle, ten times (≈ 60 weeks, across New Year).
    for (let i = 0; i < 10; i += 1) {
      scrollLeft = (current.weeks - 1) * W;
      shownMonday = addDays(current.start, 7 * shownWeekIndex(scrollLeft, W, current.weeks));
      const next = recenterStrip(current, shownWeekIndex(scrollLeft, W, current.weeks))!;
      scrollLeft = rebasedScrollLeft(scrollLeft, W, current, next.window);
      current = next.window;
      expect(addDays(current.start, 7 * shownWeekIndex(scrollLeft, W, current.weeks))).toBe(shownMonday);
      expect(current.weeks).toBe(13);
    }
    expect(diffCalendarDays(shownMonday, mondayOf("2026-12-02"))).toBe(7 * 6 * 10);
  });

  it("reads the shown week from scrollLeft (nearest snap point, clamped)", () => {
    expect(shownWeekIndex(0, W, 13)).toBe(0);
    expect(shownWeekIndex(6 * W, W, 13)).toBe(6);
    expect(shownWeekIndex(6 * W + 180, W, 13)).toBe(6);
    expect(shownWeekIndex(6 * W + 200, W, 13)).toBe(7);
    expect(shownWeekIndex(99 * W, W, 13)).toBe(12);
    expect(shownWeekIndex(-50, W, 13)).toBe(0);
    expect(shownWeekIndex(500, 0, 13)).toBe(0); // not laid out
  });
});

describe("selection vs scrolling", () => {
  const selected = "2026-10-14"; // Wednesday, W42
  const win = stripWindowAround(selected);

  it("tapping a day in the shown week needs no scroll", () => {
    const shown = weekScrollLeft(win, selected, W);
    expect(planReveal(win, selected, W, shown)).toEqual({ kind: "none" });
    expect(planReveal(win, "2026-10-18", W, shown)).toEqual({ kind: "none" }); // Sunday, same week
  });

  it("a selection change elsewhere (grid swipe into the next week, Today) scrolls to its week", () => {
    const shown = weekScrollLeft(win, selected, W);
    expect(planReveal(win, "2026-10-19", W, shown)).toEqual({ kind: "scroll", left: 7 * W });
    // The user had scrolled the strip three weeks ahead without tapping; Today brings it back.
    expect(planReveal(win, selected, W, 9 * W)).toEqual({ kind: "scroll", left: 6 * W });
  });

  it("a day that is not rendered (date picker jump) rebuilds the window around it", () => {
    const plan = planReveal(win, "2027-03-03", W, 6 * W);
    expect(plan).toEqual({ kind: "rebuild", window: stripWindowAround("2027-03-03"), left: 6 * W });
  });

  it("scrolling away never moves the selection; the tab stop falls back to the shown week", () => {
    // Scrolled ≥ 7 weeks forward: re-centring dropped the selected week from the window.
    const far = recenterStrip(recenterStrip(win, 12)!.window, 12)!.window;
    expect(windowContains(far, selected)).toBe(false);
    expect(stripTabStop(far, null, selected, () => 6)).toBe(addDays(far.start, 42));
    // While the selected day is rendered it is the tab stop; a focused day wins over it.
    expect(stripTabStop(win, null, selected, () => 0)).toBe(selected);
    expect(stripTabStop(win, "2026-10-20", selected, () => 0)).toBe("2026-10-20");
    expect(stripTabStop(win, "2025-01-01", selected, () => 0)).toBe(selected); // stale focus
  });
});

describe("auto-scroll target", () => {
  const win = stripWindowAround("2026-10-17");

  it("is the left edge of the day's week (one week per screen)", () => {
    expect(stripScrollTarget(win, "2026-10-17", W, 0)).toBe(6 * W);
    expect(stripScrollTarget(win, win.start, W, 6 * W)).toBe(0);
    expect(stripScrollTarget(win, "2026-10-19", 412, 0)).toBe(7 * 412);
  });

  it("is null when the week is already shown (within 1px), not laid out, or not rendered", () => {
    expect(stripScrollTarget(win, "2026-10-17", W, 6 * W)).toBeNull();
    expect(stripScrollTarget(win, "2026-10-17", W, 6 * W + 0.6)).toBeNull();
    expect(stripScrollTarget(win, "2026-10-17", W, 6 * W - 1.5)).toBe(6 * W);
    expect(stripScrollTarget(win, "2026-10-17", 0, 0)).toBeNull();
    expect(stripScrollTarget(win, "2027-06-01", W, 0)).toBeNull();
  });
});

describe("keyboard", () => {
  it("←/→ move one day, across week and year boundaries", () => {
    expect(moveStripFocus("2026-10-18", "ArrowRight")).toBe("2026-10-19"); // Sun W42 → Mon W43
    expect(moveStripFocus("2026-10-19", "ArrowLeft")).toBe("2026-10-18");
    expect(moveStripFocus("2027-01-04", "ArrowLeft")).toBe("2027-01-03"); // 2027-W1 → 2026-W53
    expect(moveStripFocus("2026-12-31", "ArrowRight")).toBe("2027-01-01");
  });

  it("Home/End go to the week's Monday/Sunday; PageUp/PageDown move a week", () => {
    expect(moveStripFocus("2026-10-14", "Home")).toBe("2026-10-12");
    expect(moveStripFocus("2026-10-14", "End")).toBe("2026-10-18");
    expect(moveStripFocus("2026-10-12", "Home")).toBe("2026-10-12");
    expect(moveStripFocus("2026-12-30", "End")).toBe("2027-01-03"); // W53 ends in 2027
    expect(moveStripFocus("2027-01-01", "Home")).toBe("2026-12-28");
    expect(moveStripFocus("2026-10-14", "PageDown")).toBe("2026-10-21");
    expect(moveStripFocus("2026-10-14", "PageUp")).toBe("2026-10-07");
  });

  it("leaves Enter/Space (native button activation = select) and other keys alone", () => {
    for (const key of ["Enter", " ", "Tab", "ArrowUp", "ArrowDown", "t", "j"]) {
      expect(moveStripFocus("2026-10-14", key), key).toBeNull();
    }
  });
});
