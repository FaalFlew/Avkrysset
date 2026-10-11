/** Analytics CSV (plan §4.4): BOM, CRLF, RFC 4180 quoting, formula guard, locale numbers. */
import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  analyticsCsvInputFromSnapshot,
  buildAnalyticsCsv,
  csvFormatForLocale,
  csvPeriodLabel,
  formatCsvNumber,
  guardFormula,
  quoteCsvCell,
  type AnalyticsCsvInput,
} from "../analyticsCsv";
import { analyticsBuckets, type AnalyticsSelection } from "../analyticsBuckets";
import { formatDate, formatMonthYear } from "../datetime";
import type { AnalyticsSnapshot } from "@/composables/useStats";
import { TEST_ZONE, assertZoneApplied } from "./tz";

const EN = csvFormatForLocale("en-US");
const NB = csvFormatForLocale("nb-NO");

function input(patch: Partial<AnalyticsCsvInput> = {}): AnalyticsCsvInput {
  return {
    rangeLabel: "Week 40 · Sep 28 – Oct 4, 2026",
    timeZoneLabel: "UTC+02:00 · Europe/Oslo",
    generatedAt: "Oct 11, 2026, 14:05",
    totalHours: 12.5,
    taskCount: 7,
    activeDays: 4,
    periods: [
      { key: "2026-09-28", label: "Monday, September 28, 2026", hours: 8 },
      { key: "2026-09-29", label: "Tuesday, September 29, 2026", hours: 0 },
      { key: "2026-09-30", label: "Wednesday, September 30, 2026", hours: 4.5 },
    ],
    categories: [
      { name: "Work", hours: 8 },
      { name: "Health", hours: 4.5 },
    ],
    templates: [{ name: "Morning run", category: "Health", hours: 1.25 }],
    withoutTemplateHours: 11.25,
    ...patch,
  };
}

const lines = (csv: string) => csv.slice(CSV_BOM.length).split("\r\n");

describe("csvFormatForLocale", () => {
  it("comma-decimal locales get ';' and ','", () => {
    expect(NB).toEqual({ delimiter: ";", decimal: "," });
    expect(csvFormatForLocale("de-DE")).toEqual({ delimiter: ";", decimal: "," });
    expect(csvFormatForLocale("fr-FR")).toEqual({ delimiter: ";", decimal: "," });
  });

  it("point-decimal locales get ',' and '.'", () => {
    expect(EN).toEqual({ delimiter: ",", decimal: "." });
    expect(csvFormatForLocale("en-GB")).toEqual({ delimiter: ",", decimal: "." });
    expect(csvFormatForLocale("ja-JP")).toEqual({ delimiter: ",", decimal: "." });
  });

  it("falls back to ',' and '.' for invalid locales", () => {
    expect(csvFormatForLocale("not a locale!")).toEqual({ delimiter: ",", decimal: "." });
  });
});

describe("cells", () => {
  it("guards formula triggers with a leading apostrophe", () => {
    expect(guardFormula("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(guardFormula("+47 999")).toBe("'+47 999");
    expect(guardFormula("-cmd")).toBe("'-cmd");
    expect(guardFormula("@import")).toBe("'@import");
    expect(guardFormula("\tTabbed")).toBe("'\tTabbed");
    expect(guardFormula("Deep work")).toBe("Deep work");
    expect(guardFormula("a=b")).toBe("a=b");
    expect(guardFormula("")).toBe("");
  });

  it("quotes per RFC 4180", () => {
    expect(quoteCsvCell("plain", ",")).toBe("plain");
    expect(quoteCsvCell("a,b", ",")).toBe('"a,b"');
    expect(quoteCsvCell("a,b", ";")).toBe("a,b");
    expect(quoteCsvCell("a;b", ";")).toBe('"a;b"');
    expect(quoteCsvCell('say "hi"', ",")).toBe('"say ""hi"""');
    expect(quoteCsvCell("two\nlines", ",")).toBe('"two\nlines"');
    expect(quoteCsvCell("cr\rhere", ";")).toBe('"cr\rhere"');
  });

  it("formats numbers without thousands separators", () => {
    expect(formatCsvNumber(12.5, 2, ".")).toBe("12.50");
    expect(formatCsvNumber(12.5, 2, ",")).toBe("12,50");
    expect(formatCsvNumber(1234567.891, 2, ".")).toBe("1234567.89");
    expect(formatCsvNumber(1.005, 2, ".")).toBe("1.01");
    expect(formatCsvNumber(2 / 3, 1, ",")).toBe("0,7");
    expect(formatCsvNumber(0, 1, ".")).toBe("0.0");
    expect(formatCsvNumber(-0.0001, 2, ".")).toBe("0.00");
    expect(formatCsvNumber(Number.NaN, 2, ".")).toBe("0.00");
  });
});

describe("csvPeriodLabel (same wording as the server)", () => {
  it("months, weeks and days", () => {
    expect(csvPeriodLabel("monthly", "2026-10")).toBe(formatMonthYear(2026, 9));
    expect(csvPeriodLabel("weekly", "2026-W05")).toBe("Week 5");
    expect(csvPeriodLabel("weekly", "2026-W53")).toBe("Week 53");
    expect(csvPeriodLabel("daily", "2026-10-05")).toBe(formatDate("2026-10-05", "full"));
    expect(csvPeriodLabel("weekly", "odd")).toBe("odd");
  });
});

describe("buildAnalyticsCsv", () => {
  it("starts with a BOM, uses CRLF and ends with a line break", () => {
    const csv = buildAnalyticsCsv(input(), EN);
    expect(csv.startsWith("﻿# Time Planner analytics export\r\n")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("writes the metadata rows, the header and every section (en-US)", () => {
    expect(lines(buildAnalyticsCsv(input(), EN))).toEqual([
      "# Time Planner analytics export",
      '"# Range: Week 40 · Sep 28 – Oct 4, 2026"',
      "# Time zone: UTC+02:00 · Europe/Oslo",
      '"# Generated: Oct 11, 2026, 14:05"',
      "Section,Key,Label,Category,Hours,Share %",
      "Summary,total_hours,Total hours,,12.50,",
      "Summary,task_count,Tasks,,7,",
      "Summary,active_days,Active days,,4,",
      "Summary,avg_hours_per_active_day,Average hours per active day,,3.13,",
      "Summary,top_category,Top category,Work,8.00,64.0",
      'Period,2026-09-28,"Monday, September 28, 2026",,8.00,64.0',
      'Period,2026-09-29,"Tuesday, September 29, 2026",,0.00,0.0',
      'Period,2026-09-30,"Wednesday, September 30, 2026",,4.50,36.0',
      "Category,,Work,Work,8.00,64.0",
      "Category,,Health,Health,4.50,36.0",
      "Template,,Morning run,Health,1.25,10.0",
      "Template,without_template,Without template,,11.25,90.0",
      "",
    ]);
  });

  it("uses ';' and decimal commas for nb-NO", () => {
    const rows = lines(buildAnalyticsCsv(input(), NB));
    expect(rows[3]).toBe("# Generated: Oct 11, 2026, 14:05"); // commas need no quotes with ';'
    expect(rows[4]).toBe("Section;Key;Label;Category;Hours;Share %");
    expect(rows[5]).toBe("Summary;total_hours;Total hours;;12,50;");
    expect(rows[8]).toBe("Summary;avg_hours_per_active_day;Average hours per active day;;3,13;");
    expect(rows[9]).toBe("Summary;top_category;Top category;Work;8,00;64,0");
    expect(rows[10]).toBe("Period;2026-09-28;Monday, September 28, 2026;;8,00;64,0");
    expect(rows[13]).toBe("Category;;Work;Work;8,00;64,0");
    expect(rows[16]).toBe("Template;without_template;Without template;;11,25;90,0");
  });

  it("quotes and guards user-provided names", () => {
    const csv = buildAnalyticsCsv(
      input({
        categories: [
          { name: '=HYPERLINK("http://x","click")', hours: 8 },
          { name: "Kids, school; homework", hours: 4.5 },
        ],
        templates: [{ name: "@team\nsync", category: "-1", hours: 1 }],
      }),
      EN
    );
    expect(csv).toContain('Category,,"\'=HYPERLINK(""http://x"",""click"")","\'=HYPERLINK(""http://x"",""click"")",8.00,64.0\r\n');
    expect(csv).toContain('Category,,"Kids, school; homework","Kids, school; homework",4.50,36.0\r\n');
    expect(csv).toContain("Template,,\"'@team\nsync\",'-1,1.00,8.0\r\n");
    // the top category row is guarded too
    expect(csv).toContain('Summary,top_category,Top category,"\'=HYPERLINK(""http://x"",""click"")",8.00,64.0\r\n');
  });

  it("adds the document ID row only when given (server exports)", () => {
    expect(buildAnalyticsCsv(input(), EN)).not.toContain("Document ID");
    expect(lines(buildAnalyticsCsv(input({ documentId: "TP-20261011-7K3M9QXA" }), EN))[4]).toBe(
      "# Document ID: TP-20261011-7K3M9QXA"
    );
  });

  it("handles an empty range and unknown counts", () => {
    const rows = lines(
      buildAnalyticsCsv(
        input({ totalHours: 0, taskCount: null, activeDays: null, periods: [], categories: [], templates: [], withoutTemplateHours: 0 }),
        EN
      )
    );
    expect(rows.slice(5)).toEqual([
      "Summary,total_hours,Total hours,,0.00,",
      "Summary,task_count,Tasks,,,",
      "Summary,active_days,Active days,,,",
      "Summary,avg_hours_per_active_day,Average hours per active day,,,",
      "Summary,top_category,Top category,,,",
      "Template,without_template,Without template,,0.00,0.0",
      "",
    ]);
  });
});

describe(`CSV from the analytics snapshot (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });

  function snapshotFor(selection: AnalyticsSelection, hoursByKey: Record<string, number>): AnalyticsSnapshot {
    const periods = analyticsBuckets(selection).map((b) => ({
      key: b.key,
      label: b.label,
      fullLabel: `Full ${b.key}`,
      hours: hoursByKey[b.key] ?? 0,
      categories: null,
      topCategory: hoursByKey[b.key] ? "Work" : null,
    }));
    const total = periods.reduce((sum, p) => sum + p.hours, 0);
    return {
      selection,
      periods,
      sparse: false,
      categories: [
        { id: "c1", name: "Work", color: "#2F7FE0", hours: total, share: 1 },
        { id: "c0", name: "Unused", color: null, hours: 0, share: 0 },
      ],
      templates: [
        { id: "t1", name: "Deep work", color: "#2F7FE0", hours: 2, share: 2 / total, deleted: false, categoryName: "Work" },
      ],
      untemplatedHours: total - 2,
      totalHours: total,
      taskCount: 3,
      activeDays: 3,
    };
  }

  it("zero-fills all 53 weeks of ISO year 2026", () => {
    const selection: AnalyticsSelection = {
      view: "weekly",
      year: 2026,
      monthRange: { start: 0, end: 11 },
      weekRange: { start: 1, end: 53 },
      dailyWeek: 1,
    };
    const snapshot = snapshotFor(selection, { "2026-W01": 1.5, "2026-W53": 3, "2026-W20": 0.25 });
    const csv = buildAnalyticsCsv(
      analyticsCsvInputFromSnapshot(snapshot, { rangeLabel: "Weeks 1–53", timeZoneLabel: "UTC", generatedAt: "now" }),
      EN
    );
    const periodRows = lines(csv).filter((l) => l.startsWith("Period,"));
    expect(periodRows).toHaveLength(53);
    expect(periodRows[0]).toBe("Period,2026-W01,Week 1,,1.50,31.6");
    expect(periodRows[1]).toBe("Period,2026-W02,Week 2,,0.00,0.0");
    expect(periodRows[52]).toBe("Period,2026-W53,Week 53,,3.00,63.2");
    expect(periodRows.map((r) => r.split(",")[1])).toEqual(
      Array.from({ length: 53 }, (_, i) => `2026-W${String(i + 1).padStart(2, "0")}`)
    );
    // zero-hour categories are left out; templates carry their category
    expect(csv).not.toContain("Unused");
    expect(csv).toContain("Template,,Deep work,Work,2.00,42.1\r\n");
    expect(csv).toContain("Category,,Work,Work,4.75,100.0\r\n");
    expect(csv).toContain("Template,without_template,Without template,,2.75,57.9\r\n");
    expect(csv).toContain("Summary,task_count,Tasks,,3,\r\n");
  });

  it("uses the month and day keys of the other views", () => {
    const monthly: AnalyticsSelection = {
      view: "monthly",
      year: 2026,
      monthRange: { start: 10, end: 11 },
      weekRange: { start: 1, end: 53 },
      dailyWeek: 1,
    };
    const daily: AnalyticsSelection = { ...monthly, view: "daily", year: 2026, dailyWeek: 53 };
    const keys = (sel: AnalyticsSelection) =>
      lines(
        buildAnalyticsCsv(
          analyticsCsvInputFromSnapshot(snapshotFor(sel, {}), { rangeLabel: "r", timeZoneLabel: "z", generatedAt: "g" }),
          NB
        )
      )
        .filter((l) => l.startsWith("Period;"))
        .map((l) => l.split(";")[1]);
    expect(keys(monthly)).toEqual(["2026-11", "2026-12"]);
    expect(keys(daily)).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });
});
