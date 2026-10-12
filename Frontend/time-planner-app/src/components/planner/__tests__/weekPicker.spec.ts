/**
 * Week-number picker logic: ISO week-years (52/53 weeks), what a week covers, the planner date a
 * pick sets, keyboard moves in the week and year grids, and year pages.
 */
import { describe, expect, it } from "vitest";
import {
  MIN_PICKER_YEAR,
  moveWeekFocus,
  moveYearFocus,
  selectWeekDate,
  weekCells,
  weekLabel,
  yearPage,
  yearPageStart,
} from "../weekPicker";
import { formatDateRange, isoWeekOf, isoWeekday } from "@/lib/datetime";
import { assertZoneApplied, TEST_ZONE } from "@/lib/__tests__/tz";

describe(`zone sanity (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });
});

describe("ISO week-years", () => {
  it("2026 has 53 weeks; W53 starts 2026-12-28; 2027-W01 starts 2027-01-04", () => {
    const weeks2026 = weekCells(2026);
    expect(weeks2026).toHaveLength(53);
    expect(weeks2026[52]).toMatchObject({ week: 53, start: "2026-12-28", end: "2027-01-03" });
    expect(weekCells(2027)[0]).toMatchObject({ week: 1, start: "2027-01-04", end: "2027-01-10" });
    expect(weekCells(2027)).toHaveLength(52);
    expect(weekCells(2025)).toHaveLength(52);
    expect(weekCells(2020)).toHaveLength(53);
  });

  it("weeks are consecutive Mondays with no gaps between years", () => {
    const all = [...weekCells(2026), ...weekCells(2027)];
    for (const cell of all) expect(isoWeekday(cell.start)).toBe(1);
    expect(weekCells(2026)[52]!.end).toBe("2027-01-03");
    expect(weekCells(2027)[0]!.start).toBe("2027-01-04");
  });

  it("New Year's Day 2027 belongs to 2026-W53, so the picker shows 2026 (no jump)", () => {
    expect(isoWeekOf("2027-01-01")).toEqual({ isoYear: 2026, week: 53 });
    expect(selectWeekDate(2026, 53, "2027-01-01")).toBe("2027-01-01");
  });
});

describe("labels", () => {
  it("say which dates a week covers", () => {
    expect(weekLabel(2026, 41)).toBe(`Week 41 · ${formatDateRange("2026-10-05", "2026-10-11")}`);
    expect(weekCells(2026)[40]!.label).toBe(weekLabel(2026, 41));
    expect(weekLabel(2026, 53)).toBe(`Week 53 · ${formatDateRange("2026-12-28", "2027-01-03")}`);
  });
});

describe("picking a week", () => {
  it("keeps the selected weekday (phone day view) within the picked week", () => {
    expect(selectWeekDate(2027, 1, "2026-10-07")).toBe("2027-01-06"); // Wednesday → Wednesday
    expect(selectWeekDate(2026, 41, "2026-03-02")).toBe("2026-10-05"); // Monday → Monday
    expect(selectWeekDate(2026, 41, "2026-03-08")).toBe("2026-10-11"); // Sunday → Sunday
  });

  it("from the year grid: 2026 → 2027, then week 1", () => {
    const start = yearPageStart(2026);
    expect(yearPage(start)).toContain(2026);
    const moved = moveYearFocus(2026, start, "ArrowRight")!;
    expect(moved.year).toBe(2027);
    expect(weekCells(moved.year)[0]!.start).toBe("2027-01-04");
    expect(isoWeekOf(selectWeekDate(moved.year, 1, "2026-10-04"))).toEqual({ isoYear: 2027, week: 1 });
  });
});

describe("keyboard in the week grid (7 columns)", () => {
  it("←/→ cross into the previous/next ISO year", () => {
    expect(moveWeekFocus({ isoYear: 2027, week: 1 }, "ArrowLeft", 7)).toEqual({ isoYear: 2026, week: 53 });
    expect(moveWeekFocus({ isoYear: 2026, week: 53 }, "ArrowRight", 7)).toEqual({ isoYear: 2027, week: 1 });
    expect(moveWeekFocus({ isoYear: 2026, week: 10 }, "ArrowRight", 7)).toEqual({ isoYear: 2026, week: 11 });
  });

  it("↑/↓ move a row and stay inside the year", () => {
    expect(moveWeekFocus({ isoYear: 2026, week: 10 }, "ArrowUp", 7)).toEqual({ isoYear: 2026, week: 3 });
    expect(moveWeekFocus({ isoYear: 2026, week: 3 }, "ArrowUp", 7)).toEqual({ isoYear: 2026, week: 3 });
    expect(moveWeekFocus({ isoYear: 2026, week: 46 }, "ArrowDown", 7)).toEqual({ isoYear: 2026, week: 53 });
    expect(moveWeekFocus({ isoYear: 2026, week: 50 }, "ArrowDown", 7)).toEqual({ isoYear: 2026, week: 50 });
    expect(moveWeekFocus({ isoYear: 2026, week: 10 }, "ArrowDown", 5)).toEqual({ isoYear: 2026, week: 15 });
  });

  it("Home/End and PageUp/PageDown (same week number, clamped)", () => {
    expect(moveWeekFocus({ isoYear: 2026, week: 20 }, "Home", 7)).toEqual({ isoYear: 2026, week: 1 });
    expect(moveWeekFocus({ isoYear: 2026, week: 20 }, "End", 7)).toEqual({ isoYear: 2026, week: 53 });
    expect(moveWeekFocus({ isoYear: 2026, week: 53 }, "PageDown", 7)).toEqual({ isoYear: 2027, week: 52 });
    expect(moveWeekFocus({ isoYear: 2027, week: 52 }, "PageUp", 7)).toEqual({ isoYear: 2026, week: 52 });
    expect(moveWeekFocus({ isoYear: 2026, week: 5 }, "Tab", 7)).toBeNull();
  });

  it("never goes before 1970", () => {
    expect(moveWeekFocus({ isoYear: MIN_PICKER_YEAR, week: 1 }, "ArrowLeft", 7)).toEqual({ isoYear: 1970, week: 1 });
    expect(moveWeekFocus({ isoYear: MIN_PICKER_YEAR, week: 9 }, "PageUp", 7)).toEqual({ isoYear: 1970, week: 9 });
  });
});

describe("year grid", () => {
  it("pages of 12 roughly centered on the viewed year, not before 1970", () => {
    expect(yearPageStart(2026)).toBe(2020);
    expect(yearPage(2020)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031]);
    expect(yearPageStart(1972)).toBe(1970);
  });

  it("keyboard: arrows, rows of 4, Home/End, PageUp/PageDown; the page follows", () => {
    expect(moveYearFocus(2026, 2020, "ArrowDown")).toEqual({ year: 2030, pageStart: 2020 });
    expect(moveYearFocus(2030, 2020, "ArrowDown")).toEqual({ year: 2034, pageStart: 2032 });
    expect(moveYearFocus(2020, 2020, "ArrowLeft")).toEqual({ year: 2019, pageStart: 2008 });
    expect(moveYearFocus(2026, 2020, "Home")).toEqual({ year: 2020, pageStart: 2020 });
    expect(moveYearFocus(2026, 2020, "End")).toEqual({ year: 2031, pageStart: 2020 });
    expect(moveYearFocus(2026, 2020, "PageDown")).toEqual({ year: 2038, pageStart: 2032 });
    expect(moveYearFocus(1975, 1970, "PageUp")).toEqual({ year: 1970, pageStart: 1970 });
    expect(moveYearFocus(2026, 2020, "x")).toBeNull();
  });
});
