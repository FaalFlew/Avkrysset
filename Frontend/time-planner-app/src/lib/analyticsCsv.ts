// src/lib/analyticsCsv.ts — the analytics CSV (plan §4.4). ONE format shared by the browser
// (guest export, built from the on-screen snapshot) and the server (account export):
//
//   - UTF-8 with BOM, CRLF line endings, RFC 4180 quoting.
//   - Locale-aware numbers (plan §8 Q10): comma-decimal locales (nb-NO, de-DE, …) get delimiter
//     ';' and decimal ','; everything else gets ',' and '.'. No thousands separators.
//   - Leading metadata rows (first cell only): "# Time Planner analytics export", "# Range: …",
//     "# Time zone: …", "# Generated: …" (+ "# Document ID: …" from the server only).
//   - Header: Section,Key,Label,Category,Hours,Share %
//   - Sections, in order:
//       Summary  keys total_hours, task_count, active_days, avg_hours_per_active_day, top_category
//                (the value is in the Hours column; counts are whole numbers; top_category names
//                the category in the Category column with its hours and share)
//       Period   one row per bucket, zero-filled; keys yyyy-MM / yyyy-Www / yyyy-MM-dd; labels
//                "October 2026" / "Week 40" / "Monday, October 5, 2026" (locale dates)
//       Category Label and Category = the category name (no key)
//       Template Category = the template's category when known, empty for deleted templates (no
//                key); the "Without template" row (key without_template) is always present, last
//     Categories and templates are ordered by hours DESC, then name, then id — ordinal comparison
//     (src/lib/analyticsOrder.ts, same rule as the server); top_category is the first category.
//   - Hours with 2 decimals, Share % with 1 decimal (share of the range total).
//   - Formula-injection guard: text cells starting with = + - @ or tab get a leading '.
// The server's writer is TimePlanner.API/Features/Reports/CsvReportWriter.cs — keep them in sync.

import type { AnalyticsSnapshot } from "@/composables/useStats";
import type { AnalyticsView } from "@/lib/analyticsBuckets";
import { formatDate, formatMonthYear, isDateKey } from "@/lib/datetime";
import { rankByHours } from "@/lib/analyticsOrder";

export const CSV_BOM = "﻿";
export const CSV_EOL = "\r\n";
export const CSV_HEADER = ["Section", "Key", "Label", "Category", "Hours", "Share %"] as const;
export const WITHOUT_TEMPLATE_KEY = "without_template";

export interface CsvNumberFormat {
  delimiter: "," | ";";
  decimal: "." | ",";
}

/** Delimiter and decimal separator for a locale (`nb-NO` → `;` + `,`; `en-US` → `,` + `.`). */
export function csvFormatForLocale(locale: string | null | undefined): CsvNumberFormat {
  let decimal = ".";
  try {
    decimal =
      new Intl.NumberFormat(locale || undefined).formatToParts(1.5).find((p) => p.type === "decimal")
        ?.value ?? ".";
  } catch {
    decimal = ".";
  }
  return decimal === "," ? { delimiter: ";", decimal: "," } : { delimiter: ",", decimal: "." };
}

const FORMULA_TRIGGER = /^[=+\-@\t]/;

/** Neutralize spreadsheet formulas in a text cell: `=SUM(A1)` → `'=SUM(A1)`. */
export function guardFormula(text: string): string {
  return FORMULA_TRIGGER.test(text) ? `'${text}` : text;
}

/** RFC 4180: quote when the cell contains the delimiter, a quote, CR or LF; double inner quotes. */
export function quoteCsvCell(value: string, delimiter: string): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Fixed-point number without thousands separators: (12.345, 2, ",") → "12,35". */
export function formatCsvNumber(value: number, digits: number, decimal: "." | ","): string {
  const v = Number.isFinite(value) ? value : 0;
  const factor = 10 ** digits;
  const rounded = (Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON) * factor)) / factor;
  let text = rounded.toFixed(digits);
  if (/^-0(?:\.0+)?$/.test(text)) text = text.slice(1);
  return decimal === "," ? text.replace(".", ",") : text;
}

/** A row cell: text (guarded against formulas), an already formatted number, or empty (null). */
export type CsvCell = { text: string } | { num: string } | null;

export const csvText = (value: string | null | undefined): CsvCell => ({ text: value ?? "" });
export const csvNum = (value: string): CsvCell => ({ num: value });
const text = csvText;
const num = csvNum;

/** One CSV line: cells quoted per RFC 4180, text cells guarded against formulas. */
export function csvRow(cells: readonly CsvCell[], delimiter: string): string {
  return cells
    .map((cell) => {
      if (cell === null) return "";
      if ("num" in cell) return quoteCsvCell(cell.num, delimiter);
      return quoteCsvCell(guardFormula(cell.text), delimiter);
    })
    .join(delimiter);
}

/** A metadata line (`# Range: …`): one quoted-if-needed cell. */
export function csvMetaLine(line: string, delimiter: string): string {
  return quoteCsvCell(line, delimiter);
}

/** The file text: BOM + lines joined and terminated by CRLF. */
export function csvDocument(lines: readonly string[]): string {
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

export interface CsvPeriodRow {
  key: string;
  label: string;
  hours: number;
}

export interface CsvCategoryRow {
  /** Only used for ordering (not written). */
  id: string;
  name: string;
  hours: number;
}

export interface CsvTemplateRow {
  /** Only used for ordering (not written). */
  id: string;
  name: string;
  category: string | null;
  hours: number;
}

export interface AnalyticsCsvInput {
  rangeLabel: string;
  timeZoneLabel: string;
  /** Local date-time, already formatted (datetime.ts). */
  generatedAt: string;
  /** Server exports only. */
  documentId?: string | null;
  totalHours: number;
  /** null when unknown (rendered as an empty cell). */
  taskCount: number | null;
  activeDays: number | null;
  periods: CsvPeriodRow[];
  /** Any order: written hours DESC, then name, then id (ordinal); the first is the top category. */
  categories: CsvCategoryRow[];
  templates: CsvTemplateRow[];
  withoutTemplateHours: number;
}

/** The complete CSV text, starting with the BOM. */
export function buildAnalyticsCsv(input: AnalyticsCsvInput, format: CsvNumberFormat): string {
  const { delimiter, decimal } = format;
  const hours = (h: number) => num(formatCsvNumber(h, 2, decimal));
  const total = Number.isFinite(input.totalHours) ? input.totalHours : 0;
  const share = (h: number) => num(formatCsvNumber(total > 0 ? (h / total) * 100 : 0, 1, decimal));
  const count = (n: number | null) => (n === null ? null : num(String(Math.round(n))));

  const lines: string[] = [];
  const meta = (line: string) => lines.push(csvMetaLine(line, delimiter));
  const row = (cells: CsvCell[]) => lines.push(csvRow(cells, delimiter));

  meta("# Time Planner analytics export");
  meta(`# Range: ${input.rangeLabel}`);
  meta(`# Time zone: ${input.timeZoneLabel}`);
  meta(`# Generated: ${input.generatedAt}`);
  if (input.documentId) meta(`# Document ID: ${input.documentId}`);

  row(CSV_HEADER.map((h) => text(h)));

  // Summary
  const categories = rankByHours(input.categories);
  const templates = rankByHours(input.templates);
  const top = categories.find((c) => c.hours > 0) ?? null;
  const activeDays = input.activeDays;
  row([text("Summary"), text("total_hours"), text("Total hours"), null, hours(total), null]);
  row([text("Summary"), text("task_count"), text("Tasks"), null, count(input.taskCount), null]);
  row([text("Summary"), text("active_days"), text("Active days"), null, count(activeDays), null]);
  row([
    text("Summary"),
    text("avg_hours_per_active_day"),
    text("Average hours per active day"),
    null,
    activeDays === null ? null : hours(activeDays > 0 ? total / activeDays : 0),
    null,
  ]);
  row([
    text("Summary"),
    text("top_category"),
    text("Top category"),
    top ? text(top.name) : null,
    top ? hours(top.hours) : null,
    top ? share(top.hours) : null,
  ]);

  for (const p of input.periods) {
    row([text("Period"), text(p.key), text(p.label), null, hours(p.hours), share(p.hours)]);
  }
  for (const c of categories) {
    row([text("Category"), null, text(c.name), text(c.name), hours(c.hours), share(c.hours)]);
  }
  for (const t of templates) {
    row([text("Template"), null, text(t.name), t.category ? text(t.category) : null, hours(t.hours), share(t.hours)]);
  }
  row([
    text("Template"),
    text(WITHOUT_TEMPLATE_KEY),
    text("Without template"),
    null,
    hours(input.withoutTemplateHours),
    share(input.withoutTemplateHours),
  ]);

  return csvDocument(lines);
}

const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const WEEK_KEY = /^\d{4}-W(\d{2})$/;

/** Period label like the server's: "October 2026", "Week 40", "Monday, October 5, 2026". */
export function csvPeriodLabel(view: AnalyticsView, key: string): string {
  if (view === "monthly") {
    const m = MONTH_KEY.exec(key);
    return m ? formatMonthYear(Number(m[1]), Number(m[2]) - 1) : key;
  }
  if (view === "weekly") {
    const m = WEEK_KEY.exec(key);
    return m ? `Week ${Number(m[1])}` : key;
  }
  return isDateKey(key) ? formatDate(key, "full") : key;
}

export interface CsvMeta {
  rangeLabel: string;
  timeZoneLabel: string;
  generatedAt: string;
}

/** Map the analytics page's snapshot (guest data) onto the CSV input. */
export function analyticsCsvInputFromSnapshot(snapshot: AnalyticsSnapshot, meta: CsvMeta): AnalyticsCsvInput {
  return {
    ...meta,
    documentId: null,
    totalHours: snapshot.totalHours,
    taskCount: snapshot.taskCount,
    activeDays: snapshot.activeDays,
    periods: snapshot.periods.map((p) => ({
      key: p.key,
      label: csvPeriodLabel(snapshot.selection.view, p.key),
      hours: p.hours,
    })),
    categories: snapshot.categories
      .filter((c) => c.hours > 0)
      .map((c) => ({ id: c.id, name: c.name, hours: c.hours })),
    templates: snapshot.templates
      .filter((t) => t.hours > 0)
      .map((t) => ({ id: t.id, name: t.name, category: t.deleted ? null : t.categoryName, hours: t.hours })),
    withoutTemplateHours: snapshot.untemplatedHours,
  };
}
