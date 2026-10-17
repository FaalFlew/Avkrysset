/** Report export selection → query (plan §1 "Reconciled contracts"), per zone. */
import { describe, expect, it } from "vitest";
import type { AnalyticsSelection } from "../analyticsBuckets";
import {
  exportUrl,
  personalReportUrl,
  personalTaskListCsvUrl,
  TASKS_FILE_PREFIX,
  reportFileStem,
  reportQuery,
  reportQueryString,
  reportSelection,
} from "../reportQuery";
import { TEST_ZONE, assertZoneApplied } from "./tz";

const base: AnalyticsSelection = {
  view: "monthly",
  year: 2026,
  monthRange: { start: 0, end: 11 },
  weekRange: { start: 1, end: 53 },
  dailyWeek: 41,
};

const sel = (patch: Partial<AnalyticsSelection>): AnalyticsSelection => ({ ...base, ...patch });

describe(`report selection (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });

  it("monthly: calendar year + 0-based month indexes", () => {
    expect(reportSelection(sel({ view: "monthly" }))).toEqual({ view: "monthly", year: 2026, from: 0, to: 11 });
    expect(reportSelection(sel({ view: "monthly", monthRange: { start: 2, end: 4 } }))).toEqual({
      view: "monthly",
      year: 2026,
      from: 2,
      to: 4,
    });
    expect(reportSelection(sel({ view: "monthly", monthRange: { start: 11, end: 11 } }))).toEqual({
      view: "monthly",
      year: 2026,
      from: 11,
      to: 11,
    });
  });

  it("monthly: out-of-range months are clamped (start ≤ end)", () => {
    expect(reportSelection(sel({ view: "monthly", monthRange: { start: -3, end: 14 } }))).toMatchObject({ from: 0, to: 11 });
    expect(reportSelection(sel({ view: "monthly", monthRange: { start: 5, end: 2 } }))).toMatchObject({ from: 5, to: 5 });
  });

  it("weekly: ISO week-year + ISO weeks, including 2026-W53", () => {
    expect(reportSelection(sel({ view: "weekly" }))).toEqual({ view: "weekly", year: 2026, from: 1, to: 53 });
    expect(reportSelection(sel({ view: "weekly", weekRange: { start: 53, end: 53 } }))).toEqual({
      view: "weekly",
      year: 2026,
      from: 53,
      to: 53,
    });
  });

  it("weekly: 2025-W01 (which starts on 2024-12-30) is week 1 of ISO year 2025", () => {
    expect(reportSelection(sel({ view: "weekly", year: 2025, weekRange: { start: 1, end: 1 } }))).toEqual({
      view: "weekly",
      year: 2025,
      from: 1,
      to: 1,
    });
  });

  it("weekly: week 53 is clamped to 52 in a 52-week ISO year", () => {
    expect(reportSelection(sel({ view: "weekly", year: 2027, weekRange: { start: 50, end: 53 } }))).toEqual({
      view: "weekly",
      year: 2027,
      from: 50,
      to: 52,
    });
  });

  it("daily: ISO week-year + from = to = the week shown", () => {
    expect(reportSelection(sel({ view: "daily", dailyWeek: 41 }))).toEqual({ view: "daily", year: 2026, from: 41, to: 41 });
    expect(reportSelection(sel({ view: "daily", year: 2026, dailyWeek: 53 }))).toEqual({
      view: "daily",
      year: 2026,
      from: 53,
      to: 53,
    });
    expect(reportSelection(sel({ view: "daily", year: 2025, dailyWeek: 1 }))).toEqual({ view: "daily", year: 2025, from: 1, to: 1 });
  });

  it("ignores the ranges of the other views", () => {
    const q = reportSelection(sel({ view: "daily", dailyWeek: 7, monthRange: { start: 3, end: 3 }, weekRange: { start: 9, end: 9 } }));
    expect(q).toEqual({ view: "daily", year: 2026, from: 7, to: 7 });
  });
});

describe("report query string and URL", () => {
  it("lists the parameters in contract order", () => {
    const query = reportQuery(sel({ view: "weekly", weekRange: { start: 53, end: 53 } }), "A4", "nb-NO");
    expect(reportQueryString(query)).toBe("view=weekly&year=2026&from=53&to=53&paper=A4&locale=nb-NO");
  });

  it("builds the personal report URL for PDF and CSV (relative to the /api base URL)", () => {
    const query = reportQuery(sel({ view: "monthly", monthRange: { start: 2, end: 4 } }), "Letter", "en-US");
    expect(personalReportUrl("pdf", query)).toBe(
      "/reports/personal.pdf?view=monthly&year=2026&from=2&to=4&paper=Letter&locale=en-US"
    );
    expect(personalReportUrl("csv", query)).toBe(
      "/reports/personal.csv?view=monthly&year=2026&from=2&to=4&paper=Letter&locale=en-US"
    );
  });

  it("builds the task list CSV URL (no paper) and picks the URL per export kind", () => {
    const query = reportQuery(sel({ view: "weekly", weekRange: { start: 40, end: 42 } }), "A4", "nb-NO");
    expect(personalTaskListCsvUrl(query, "nb-NO")).toBe(
      "/reports/personal.tasks.csv?view=weekly&year=2026&from=40&to=42&locale=nb-NO"
    );
    expect(exportUrl("tasks-csv", query)).toBe(personalTaskListCsvUrl(query, "nb-NO"));
    expect(exportUrl("pdf", query)).toBe(personalReportUrl("pdf", query));
    expect(exportUrl("csv", query)).toBe(personalReportUrl("csv", query));
  });

  it("encodes unusual locale tags", () => {
    const query = reportQuery(sel({ view: "daily", year: 2025, dailyWeek: 1 }), "A4", "sr-Latn-RS-u-nu-latn");
    expect(personalReportUrl("pdf", query)).toBe(
      "/reports/personal.pdf?view=daily&year=2025&from=1&to=1&paper=A4&locale=sr-Latn-RS-u-nu-latn"
    );
  });
});

describe(`report file stem (${TEST_ZONE})`, () => {
  it("names months, weeks and the Day view's week", () => {
    expect(reportFileStem(sel({ view: "monthly" }))).toBe("time-planner-analytics-2026-01_2026-12");
    expect(reportFileStem(sel({ view: "monthly", monthRange: { start: 2, end: 2 } }))).toBe("time-planner-analytics-2026-03");
    expect(reportFileStem(sel({ view: "weekly", weekRange: { start: 38, end: 41 } }))).toBe(
      "time-planner-analytics-2026-W38_2026-W41"
    );
    expect(reportFileStem(sel({ view: "weekly", weekRange: { start: 53, end: 53 } }))).toBe("time-planner-analytics-2026-W53");
    expect(reportFileStem(sel({ view: "weekly", year: 2025, weekRange: { start: 1, end: 1 } }))).toBe(
      "time-planner-analytics-2025-W01"
    );
    expect(reportFileStem(sel({ view: "daily", dailyWeek: 40 }))).toBe("time-planner-analytics-2026-W40");
    expect(reportFileStem(sel({ view: "daily", year: 2025, dailyWeek: 1 }))).toBe("time-planner-analytics-2025-W01");
  });

  it("names the task list like the server: time-planner-tasks-…", () => {
    expect(reportFileStem(sel({ view: "weekly", weekRange: { start: 40, end: 40 } }), TASKS_FILE_PREFIX)).toBe(
      "time-planner-tasks-2026-W40"
    );
    expect(reportFileStem(sel({ view: "monthly" }), TASKS_FILE_PREFIX)).toBe("time-planner-tasks-2026-01_2026-12");
    expect(reportFileStem(sel({ view: "daily", dailyWeek: 43 }), TASKS_FILE_PREFIX)).toBe("time-planner-tasks-2026-W43");
  });
});
