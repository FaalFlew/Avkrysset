/**
 * Guest task list CSV — the same format as the server's personal.tasks.csv
 * (TimePlanner.API/Features/Reports/CsvReportWriter.cs WriteTasks): BOM, CRLF, RFC 4180 quoting,
 * locale delimiter/decimal (en-US `,` + `.`; nb-NO `;` + `,`), formula-injection guard, metadata
 * rows, and one row per task in list order with local dates/times of the test zone.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import { CSV_BOM } from "../analyticsCsv";
import {
  TASK_CSV_HEADER,
  buildTaskListCsv,
  csvGeneratedAt,
  formatCsvClockDuration,
  taskListCsvRows,
  type TaskListCsvRow,
} from "../taskListCsv";
import { buildTaskListRows } from "../taskList";
import { addDays, combineDateAndTime, endInstant, formatWeekdayLong, getActiveTimeZone } from "../datetime";
import { TEST_ZONE, assertZoneApplied } from "./tz";

/** The CSV's one locale: delimiter, decimal and weekday names all follow it. */
const EN = "en-US";
const NB = "nb-NO";
const META = {
  rangeLabel: "Week 42 · Oct 12 – 18, 2026",
  timeZoneLabel: "Europe/Oslo (UTC+02:00)",
  generatedAt: "2026-10-17 10:00 (Europe/Oslo)",
};
const DAY = "2026-10-14";

function row(id: string, time: string, hours: number, patch: Partial<TaskListCsvRow> = {}): TaskListCsvRow {
  const start = combineDateAndTime(DAY, time);
  return {
    id,
    start,
    end: endInstant(start, hours),
    hours,
    title: id,
    category: "Work",
    template: null,
    organization: null,
    createdBy: "You",
    assignedTo: [],
    createdAt: null,
    ...patch,
  };
}

const lines = (csv: string) => csv.slice(CSV_BOM.length).split("\r\n");

describe(`task list CSV (${TEST_ZONE})`, () => {
  it("runs in the configured zone", () => {
    assertZoneApplied();
  });

  it("en-US: BOM, CRLF, metadata, header and rows in list order", () => {
    const wed = formatWeekdayLong(DAY, EN);
    expect(wed).toBe("Wednesday");
    const csv = buildTaskListCsv(
      [
        row("Late shift", "23:30", 2, { template: "Deleted template" }),
        row("Deep work", "09:00", 1.5, { template: "Morning run" }),
      ],
      META,
      EN
    );
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.slice(CSV_BOM.length)).not.toMatch(/[^\r]\n/); // CRLF only
    expect(lines(csv)).toEqual([
      "# Time Planner task list export",
      '"# Range: Week 42 · Oct 12 – 18, 2026"', // one cell, quoted for its comma (like the server)
      "# Time zone: Europe/Oslo (UTC+02:00)",
      "# Generated: 2026-10-17 10:00 (Europe/Oslo)",
      "Date,Weekday,Start,End,End date,Duration (h),Duration,Title,Category,Template,Organization,Created by,Assigned to,Created at",
      `2026-10-14,${wed},09:00,10:30,2026-10-14,1.50,1:30,Deep work,Work,Morning run,,You,,`,
      // ends after midnight: End date is the end's local date
      `2026-10-14,${wed},23:30,01:30,${addDays(DAY, 1)},2.00,2:00,Late shift,Work,Deleted template,,You,,`,
      "",
    ]);
    expect(TASK_CSV_HEADER).toHaveLength(14);
  });

  it("nb-NO: ';' delimiter and decimal comma; quoting follows the delimiter", () => {
    const csv = buildTaskListCsv(
      [
        row("Plan; review", "08:00", 1.25),
        row("Lunch, team", "12:00", 0.75, { organization: "Acme", category: "Acme", createdBy: "Ada Admin", assignedTo: ["Kari", "Ola"] }),
      ],
      { ...META, rangeLabel: "Weeks 1–53 · Dec 29, 2025 – Jan 3, 2027" },
      NB
    );
    const wed = formatWeekdayLong(DAY, NB);
    expect(wed).toBe("onsdag"); // the CSV's locale, not the display locale
    const out = lines(csv);
    expect(out[1]).toBe("# Range: Weeks 1–53 · Dec 29, 2025 – Jan 3, 2027"); // no ';' → unquoted
    expect(out[4]).toBe(
      "Date;Weekday;Start;End;End date;Duration (h);Duration;Title;Category;Template;Organization;Created by;Assigned to;Created at"
    );
    expect(out[5]).toBe(`2026-10-14;${wed};08:00;09:15;2026-10-14;1,25;1:15;"Plan; review";Work;;;You;;`);
    expect(out[6]).toBe(`2026-10-14;${wed};12:00;12:45;2026-10-14;0,75;0:45;Lunch, team;Acme;;Acme;Ada Admin;Kari, Ola;`);

    // en-US quotes the commas instead (incl. the metadata line).
    const en = lines(buildTaskListCsv([row("Lunch, team", "12:00", 0.75, { assignedTo: ["Kari", "Ola"] })], {
      ...META,
      rangeLabel: "Weeks 1–53 · Dec 29, 2025 – Jan 3, 2027",
    }, EN));
    expect(en[1]).toBe('"# Range: Weeks 1–53 · Dec 29, 2025 – Jan 3, 2027"');
    expect(en[5]).toContain(',"Lunch, team",Work,,,You,"Kari, Ola",');
  });

  it("weekday names follow the CSV's locale, whatever the display locale is", () => {
    const nb = lines(buildTaskListCsv([row("A", "09:00", 1)], META, "nb-NO"));
    expect(nb[5]!.split(";")[1]).toBe("onsdag");
    const de = lines(buildTaskListCsv([row("A", "09:00", 1)], META, "de-DE"));
    expect(de[5]!.split(";").slice(0, 2)).toEqual(["2026-10-14", "Mittwoch"]);
    const gb = lines(buildTaskListCsv([row("A", "09:00", 1)], META, "en-GB"));
    expect(gb[5]!.split(",").slice(0, 2)).toEqual(["2026-10-14", "Wednesday"]);
    // An unknown tag falls back to ',' + '.' and the display locale's names (never throws).
    const bad = lines(buildTaskListCsv([row("A", "09:00", 1)], META, "not a locale!"));
    expect(bad[5]!.split(",")[1]).toBe(formatWeekdayLong(DAY));
  });

  it("guards formulas and quotes quotes and line breaks", () => {
    const csv = buildTaskListCsv(
      [
        row("=SUM(A1:A9)", "08:00", 1, { category: "+47 999", template: "@home", createdBy: "-Ada" }),
        row('Say "hi"\nnow', "09:00", 1, { assignedTo: ["=cmd|' /C calc'!A0"] }),
      ],
      META,
      EN
    );
    const out = lines(csv);
    expect(out[5]).toContain(",'=SUM(A1:A9),'+47 999,'@home,,'-Ada,,");
    expect(csv).toContain(`,"Say ""hi""\nnow",`);
    expect(csv).toContain(`,'=cmd|' /C calc'!A0,`);
  });

  it("writes Created at as local yyyy-MM-dd HH:mm when known, and a Document ID only when given", () => {
    const created = combineDateAndTime("2026-10-01", "12:00");
    const csv = buildTaskListCsv([row("A", "09:00", 1, { createdAt: created })], { ...META, documentId: "TP-1" }, EN);
    const out = lines(csv);
    expect(out[4]).toBe("# Document ID: TP-1");
    expect(out[6]!.endsWith(",2026-10-01 12:00")).toBe(true);
    expect(buildTaskListCsv([], META, EN)).not.toContain("Document ID");
  });

  it("maps the page's rows (guest export) — same tasks, same order", () => {
    const task = (id: string, time: string, hours: number, patch: Partial<Task> = {}): Task => ({
      id,
      title: id,
      start: combineDateAndTime(DAY, time),
      duration: hours,
      categoryId: "c1",
      categoryName: "Work",
      categoryColor: "#2F7FE0",
      ...patch,
    });
    const rows = buildTaskListRows(
      [task("b", "10:00", 1, { templateId: "tpl-gone" }), task("a", "09:00", 0.5, { templateId: "tpl-1" })],
      { categories: [], templates: [{ id: "tpl-1", title: "Focus" }], currentUserId: null }
    );
    const csvRows = taskListCsvRows(rows);
    expect(csvRows.map((r) => [r.title, r.category, r.template, r.createdBy, r.createdAt])).toEqual([
      ["a", "Work", "Focus", "You", null],
      ["b", "Work", "Deleted template", "You", null],
    ]);
    const out = lines(buildTaskListCsv(csvRows, META, EN));
    expect(out.slice(5, 7).map((l) => l.split(",").slice(2, 10))).toEqual([
      ["09:00", "09:30", DAY, "0.50", "0:30", "a", "Work", "Focus"],
      ["10:00", "11:00", DAY, "1.00", "1:00", "b", "Work", "Deleted template"],
    ]);
  });

  it("durations as h:mm and the generated stamp", () => {
    expect(formatCsvClockDuration(1.5)).toBe("1:30");
    expect(formatCsvClockDuration(25)).toBe("25:00");
    expect(formatCsvClockDuration(0.25)).toBe("0:15");
    expect(formatCsvClockDuration(1 / 3)).toBe("0:20");
    expect(formatCsvClockDuration(0)).toBe("0:00");
    expect(formatCsvClockDuration(Number.NaN)).toBe("0:00");
    const stamp = csvGeneratedAt(combineDateAndTime("2026-10-17", "10:05"));
    expect(stamp).toBe(`2026-10-17 10:05 (${getActiveTimeZone()})`);
  });
});
