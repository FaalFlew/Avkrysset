import { describe, expect, it } from "vitest";
import {
  analyticsBuckets,
  analyticsRange,
  bucketKeyOf,
  clampIsoWeek,
  defaultAnalyticsPeriod,
  defaultDailyWeek,
  densifyBreakdown,
  isoWeekYearsOfCalendarYears,
  legacyBreakdownKey,
  yearsOfInstants,
  type AnalyticsSelection,
} from "../analyticsBuckets";
import {
  combineDateAndTime,
  isoWeeksRange,
  monthNames,
  monthsRange,
  startOfDayInstant,
} from "../datetime";
import { TEST_ZONE, assertZoneApplied } from "./tz";

const base: AnalyticsSelection = {
  view: "monthly",
  year: 2026,
  monthRange: { start: 0, end: 11 },
  weekRange: { start: 1, end: 53 },
  dailyWeek: 41,
};

describe(`analytics buckets (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });

  it("asks the API for the selected local range", () => {
    expect(analyticsRange({ ...base, monthRange: { start: 2, end: 4 } })).toEqual(
      monthsRange(2026, 2, 4)
    );
    expect(analyticsRange({ ...base, view: "weekly", weekRange: { start: 10, end: 12 } })).toEqual(
      isoWeeksRange(2026, 10, 12)
    );
    expect(analyticsRange({ ...base, view: "daily" })).toEqual({
      start: startOfDayInstant("2026-10-05"),
      end: startOfDayInstant("2026-10-12"),
    });
  });

  it("clamps week numbers to the ISO year", () => {
    expect(clampIsoWeek(2027, 53)).toBe(52);
    expect(clampIsoWeek(2026, 53)).toBe(53);
    expect(clampIsoWeek(2026, 0)).toBe(1);
    expect(analyticsBuckets({ ...base, year: 2027, view: "weekly" })).toHaveLength(52);
    expect(analyticsBuckets({ ...base, view: "weekly" })).toHaveLength(53);
  });

  it("builds zero-fill buckets for the selected range only", () => {
    expect(analyticsBuckets({ ...base, monthRange: { start: 9, end: 11 } })).toEqual([
      { key: "2026-10", label: monthNames()[9] },
      { key: "2026-11", label: monthNames()[10] },
      { key: "2026-12", label: monthNames()[11] },
    ]);
    expect(
      analyticsBuckets({ ...base, view: "weekly", weekRange: { start: 52, end: 53 } }).map(
        (b) => b.key
      )
    ).toEqual(["2026-W52", "2026-W53"]);
    expect(analyticsBuckets({ ...base, view: "daily" }).map((b) => b.key)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
  });

  it("buckets task starts by the local calendar", () => {
    const mondayEarly = combineDateAndTime("2026-10-05", "00:30");
    expect(bucketKeyOf("daily", mondayEarly)).toBe("2026-10-05");
    expect(bucketKeyOf("monthly", combineDateAndTime("2026-10-01", "00:30"))).toBe("2026-10");
    expect(bucketKeyOf("weekly", combineDateAndTime("2027-01-01", "00:30"))).toBe("2026-W53");
    expect(bucketKeyOf("weekly", combineDateAndTime("2025-12-29", "08:00"))).toBe("2026-W01");
  });

  it("maps legacy labels onto keys", () => {
    expect(legacyBreakdownKey(base, "March")).toBe("2026-03");
    expect(legacyBreakdownKey(base, monthNames()[4])).toBe("2026-05");
    expect(legacyBreakdownKey(base, "Smarch")).toBeNull();
    expect(legacyBreakdownKey({ ...base, view: "weekly" }, "Week 5")).toBe("2026-W05");
    expect(legacyBreakdownKey({ ...base, year: 2027, view: "weekly" }, "Week 53")).toBeNull();
    expect(legacyBreakdownKey({ ...base, view: "daily" }, "Monday")).toBe("2026-10-05");
    expect(legacyBreakdownKey({ ...base, view: "daily" }, "Sunday")).toBe("2026-10-11");
  });

  it("densifies by key, falling back to labels, and gives up on unknown items", () => {
    const sel: AnalyticsSelection = { ...base, monthRange: { start: 0, end: 2 } };
    const bars = densifyBreakdown(
      sel,
      [
        { key: "2026-02", label: "February", value: 3, dominantCategoryColor: "#111111" },
        { label: "January", value: 1.5, dominantCategoryColor: "#222222" },
      ],
      "#999999"
    );
    expect(bars).toEqual([
      { key: "2026-01", label: monthNames()[0], value: 1.5, color: "#222222" },
      { key: "2026-02", label: monthNames()[1], value: 3, color: "#111111" },
      { key: "2026-03", label: monthNames()[2], value: 0, color: "#999999" },
    ]);
    expect(
      densifyBreakdown(sel, [{ label: "???", value: 1, dominantCategoryColor: "#000000" }], "#999")
    ).toBeNull();
    expect(
      densifyBreakdown(
        sel,
        [{ key: "2026-07", label: "July", value: 1, dominantCategoryColor: "#000000" }],
        "#999"
      )
    ).toBeNull();
  });
});

describe(`analytics years: calendar vs ISO week-year (${TEST_ZONE})`, () => {
  it("opens the Week/Day views on the current ISO week-year around New Year", () => {
    // 2027-01-01 is in 2026-W53.
    expect(defaultAnalyticsPeriod("2027-01-01", [], [])).toEqual({
      calendarYear: 2027,
      isoYear: 2026,
      dailyWeek: 53,
    });
    // 2025-12-29 is in 2026-W01.
    expect(defaultAnalyticsPeriod("2025-12-29", [], [])).toEqual({
      calendarYear: 2025,
      isoYear: 2026,
      dailyWeek: 1,
    });
    expect(defaultAnalyticsPeriod("2026-10-03", [2026, 2025], [2026, 2025])).toEqual({
      calendarYear: 2026,
      isoYear: 2026,
      dailyWeek: 40,
    });
  });

  it("falls back to the newest year with data in each numbering", () => {
    // Only tasks on 2024-12-30/31: calendar year 2024, but ISO week-year 2025 (2025-W01).
    const years = yearsOfInstants([
      combineDateAndTime("2024-12-30", "09:00"),
      combineDateAndTime("2024-12-31", "18:00"),
    ]);
    expect(years).toEqual({ calendarYears: [2024], isoYears: [2025] });
    const defaults = defaultAnalyticsPeriod("2026-10-03", years.calendarYears, years.isoYears);
    expect(defaults.calendarYear).toBe(2024);
    expect(defaults.isoYear).toBe(2025);
    // The Week view of 2025 does contain those tasks:
    const sel = { ...base, view: "weekly" as const, year: 2025, weekRange: { start: 1, end: 52 } };
    expect(bucketKeyOf("weekly", combineDateAndTime("2024-12-30", "09:00"))).toBe("2025-W01");
    expect(analyticsBuckets(sel)[0]!.key).toBe("2025-W01");
  });

  it("maps calendar years to the ISO week-years their dates can fall in", () => {
    expect(isoWeekYearsOfCalendarYears([2024])).toEqual([2025, 2024]); // Dec 30-31 → 2025-W01
    expect(isoWeekYearsOfCalendarYears([2027])).toEqual([2027, 2026]); // Jan 1-3 → 2026-W53
    expect(isoWeekYearsOfCalendarYears([2026, 2025])).toEqual([2026, 2025]);
    expect(isoWeekYearsOfCalendarYears([])).toEqual([]);
  });

  it("picks the daily week relative to today", () => {
    expect(defaultDailyWeek("2026-10-03", 2026)).toBe(40);
    expect(defaultDailyWeek("2026-10-03", 2025)).toBe(52); // past year: its last week
    expect(defaultDailyWeek("2026-10-03", 2027)).toBe(1); // future year: its first week
  });
});
