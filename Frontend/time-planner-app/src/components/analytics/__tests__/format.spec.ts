import { describe, expect, it } from "vitest";
import {
  fullBucketLabel,
  isoWeekBounds,
  periodCount,
  selectionShortLabel,
  selectionSummary,
  shortBucketLabel,
  weekRangeOptionLabel,
  weekStartOptionLabel,
} from "../format";
import type { AnalyticsSelection } from "@/lib/analyticsBuckets";
import { formatDate, formatDateRange, formatMonthYear, formatWeekdayDay, monthNames } from "@/lib/datetime";

const base: AnalyticsSelection = {
  view: "monthly",
  year: 2026,
  monthRange: { start: 0, end: 11 },
  weekRange: { start: 1, end: 53 },
  dailyWeek: 40,
};

describe("analytics labels", () => {
  it("labels buckets for axes and tooltips", () => {
    expect(shortBucketLabel("monthly", "2026-03")).toBe(monthNames("short")[2]);
    expect(fullBucketLabel("monthly", "2026-03")).toBe(formatMonthYear(2026, 2));
    expect(shortBucketLabel("weekly", "2026-W05")).toBe("W5");
    expect(fullBucketLabel("weekly", "2026-W53")).toBe(
      `Week 53 · ${formatDateRange("2026-12-28", "2027-01-03")}`
    );
    expect(shortBucketLabel("daily", "2026-10-05")).toBe(formatWeekdayDay("2026-10-05"));
    expect(fullBucketLabel("daily", "2026-10-05")).toBe(formatDate("2026-10-05", "weekdayShort"));
  });

  it("passes unknown keys through (sparse server data)", () => {
    expect(shortBucketLabel("monthly", "Smarch")).toBe("Smarch");
    expect(fullBucketLabel("weekly", "Week ?")).toBe("Week ?");
  });

  it("computes ISO week bounds across the year boundary", () => {
    expect(isoWeekBounds(2026, 1)).toEqual({ start: "2025-12-29", end: "2026-01-04" });
    expect(isoWeekBounds(2026, 53)).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });

  it("builds picker option labels", () => {
    expect(weekStartOptionLabel(2026, 1)).toBe(`W1 · ${formatDate("2025-12-29", "monthDay")}`);
    expect(weekRangeOptionLabel(2026, 40)).toBe(
      `W40 · ${formatDateRange("2026-09-28", "2026-10-04")}`
    );
  });

  it("summarizes selections", () => {
    const months = monthNames("short");
    expect(selectionSummary(base, 12)).toBe(`${months[0]} – ${months[11]} 2026 · 12 months`);
    expect(selectionSummary({ ...base, monthRange: { start: 2, end: 2 } }, 1)).toBe(
      `${formatMonthYear(2026, 2)} · 1 month`
    );
    expect(selectionSummary({ ...base, view: "weekly" }, 53)).toBe(
      `Weeks 1–53 · ${formatDateRange("2025-12-29", "2027-01-03")}`
    );
    expect(selectionSummary({ ...base, view: "daily" }, 7)).toBe(
      `Week 40 · ${formatDateRange("2026-09-28", "2026-10-04")}`
    );
    expect(selectionShortLabel({ ...base, view: "weekly", weekRange: { start: 3, end: 9 } })).toBe(
      "W3–W9 2026"
    );
    expect(selectionShortLabel({ ...base, view: "daily" })).toBe("Week 40, 2026");
    expect(periodCount("daily", 1)).toBe("1 day");
    expect(periodCount("weekly", 53)).toBe("53 weeks");
  });
});
