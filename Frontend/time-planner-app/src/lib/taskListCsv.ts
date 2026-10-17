// src/lib/taskListCsv.ts — the task list CSV (docs/plans/analytics-task-list.md). Signed-in users
// download the server's file (GET /api/reports/personal.tasks.csv); guests get the same format
// built here from their local tasks:
//
//   - UTF-8 with BOM, CRLF line endings, RFC 4180 quoting, formula-injection guard, and the
//     locale-aware delimiter/decimal of the analytics CSV (src/lib/analyticsCsv.ts: `;` + `,` for
//     comma-decimal locales such as nb-NO, else `,` + `.`).
//   - Metadata rows: "# Time Planner task list export", "# Range: …", "# Time zone: …",
//     "# Generated: yyyy-MM-dd HH:mm (<zone>)" (+ "# Document ID: …" from the server only).
//   - Header: Date,Weekday,Start,End,End date,Duration (h),Duration,Title,Category,Template,
//             Organization,Created by,Assigned to,Created at
//   - One row per task, in list order (start, title, id — src/lib/taskList.ts):
//       Date/End date "yyyy-MM-dd" and Start/End "HH:mm" in the user's zone (End date is the local
//       date of the end instant); Weekday in the locale ("Monday", "mandag"); Duration (h) with 2
//       decimals; Duration as "h:mm" ("1:30", "25:00"); Category = the analytics grouping (org tasks
//       under the organization); Template empty when none ("Deleted template" when it is gone);
//       Assigned to = names joined with ", "; Created at = local "yyyy-MM-dd HH:mm" (empty when
//       unknown, e.g. guest tasks).
// No totals row (the analytics CSV has them). Keep in sync with the server's task CSV writer.

import {
  csvDocument,
  csvMetaLine,
  csvNum,
  csvRow,
  csvText,
  formatCsvNumber,
  type CsvNumberFormat,
} from "@/lib/analyticsCsv";
import {
  formatWeekdayLong,
  getActiveTimeZone,
  splitInstant,
  type InstantInput,
  type UtcIsoString,
} from "@/lib/datetime";
import { compareTaskListRows, type TaskListRow } from "@/lib/taskList";

export const TASK_CSV_HEADER = [
  "Date",
  "Weekday",
  "Start",
  "End",
  "End date",
  "Duration (h)",
  "Duration",
  "Title",
  "Category",
  "Template",
  "Organization",
  "Created by",
  "Assigned to",
  "Created at",
] as const;

export interface TaskListCsvRow {
  /** Only used for ordering (not written). */
  id: string;
  start: UtcIsoString;
  end: UtcIsoString;
  hours: number;
  title: string;
  category: string;
  template: string | null;
  organization: string | null;
  createdBy: string;
  assignedTo: readonly string[];
  /** When the task was created; null when unknown. */
  createdAt: UtcIsoString | null;
}

export interface TaskListCsvMeta {
  rangeLabel: string;
  timeZoneLabel: string;
  /** See {@link csvGeneratedAt}. */
  generatedAt: string;
  /** Server exports only. */
  documentId?: string | null;
}

/** "1:30" for 1.5 hours, "25:00" for 25 (whole minutes, no day rollover). */
export function formatCsvClockDuration(hours: number): string {
  const minutes = Math.max(0, Math.round((Number.isFinite(hours) ? hours : 0) * 60));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Local "yyyy-MM-dd HH:mm" of an instant. */
export function csvLocalDateTime(value: InstantInput): string {
  const { date, time } = splitInstant(value);
  return `${date} ${time}`;
}

/** The "# Generated:" value, like the server's: "2026-10-05 10:00 (Europe/Oslo)". */
export function csvGeneratedAt(at: InstantInput): string {
  return `${csvLocalDateTime(at)} (${getActiveTimeZone()})`;
}

/** The complete CSV text, starting with the BOM. */
export function buildTaskListCsv(
  rows: readonly TaskListCsvRow[],
  meta: TaskListCsvMeta,
  format: CsvNumberFormat
): string {
  const { delimiter, decimal } = format;
  const lines: string[] = [];
  const metaLine = (line: string) => lines.push(csvMetaLine(line, delimiter));

  metaLine("# Time Planner task list export");
  metaLine(`# Range: ${meta.rangeLabel}`);
  metaLine(`# Time zone: ${meta.timeZoneLabel}`);
  metaLine(`# Generated: ${meta.generatedAt}`);
  if (meta.documentId) metaLine(`# Document ID: ${meta.documentId}`);

  lines.push(csvRow(TASK_CSV_HEADER.map((h) => csvText(h)), delimiter));

  for (const row of [...rows].sort(compareTaskListRows)) {
    const start = splitInstant(row.start);
    const end = splitInstant(row.end);
    lines.push(
      csvRow(
        [
          csvNum(start.date),
          csvText(formatWeekdayLong(start.date)),
          csvNum(start.time),
          csvNum(end.time),
          csvNum(end.date),
          csvNum(formatCsvNumber(row.hours, 2, decimal)),
          csvNum(formatCsvClockDuration(row.hours)),
          csvText(row.title),
          csvText(row.category),
          csvText(row.template),
          csvText(row.organization),
          csvText(row.createdBy),
          csvText(row.assignedTo.join(", ")),
          row.createdAt ? csvNum(csvLocalDateTime(row.createdAt)) : null,
        ],
        delimiter
      )
    );
  }

  return csvDocument(lines);
}

/** The page's rows as CSV rows (guest export: creation time unknown). */
export function taskListCsvRows(rows: readonly TaskListRow[]): TaskListCsvRow[] {
  return rows.map((row) => ({
    id: row.id,
    start: row.start,
    end: row.end,
    hours: row.hours,
    title: row.title,
    category: row.category.name,
    template: row.templateTitle,
    organization: row.organizationName,
    createdBy: row.createdBy,
    assignedTo: row.assigneeNames,
    createdAt: null,
  }));
}
