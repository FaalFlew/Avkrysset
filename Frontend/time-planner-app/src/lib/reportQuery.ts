// src/lib/reportQuery.ts — the selection contract for report exports (plan §1 "Reconciled
// contracts"): the client sends WHAT is selected and the server resolves the half-open range in
// the right zone (X-Time-Zone for personal reports). No instant ranges are computed here.
//
//   GET /api/reports/personal.{pdf|csv}?view=monthly|weekly|daily&year&from&to&paper=A4|Letter&locale=<BCP-47>
//   monthly → calendar year, from/to = 0-based month indexes
//   weekly  → ISO week-year, from/to = ISO weeks
//   daily   → ISO week-year, from = to = the ISO week shown

import {
  analyticsBuckets,
  normalizedBounds,
  type AnalyticsSelection,
  type AnalyticsView,
} from "@/lib/analyticsBuckets";
import type { PaperSize } from "@/lib/paper";

export type ReportFormat = "pdf" | "csv";

export interface ReportSelection {
  view: AnalyticsView;
  year: number;
  from: number;
  to: number;
}

export interface ReportQuery extends ReportSelection {
  paper: PaperSize;
  locale: string;
}

/** The selection part of the report query, clamped like the analytics page clamps it. */
export function reportSelection(sel: AnalyticsSelection): ReportSelection {
  const b = normalizedBounds(sel);
  switch (sel.view) {
    case "monthly":
      return { view: "monthly", year: sel.year, from: b.monthStart, to: b.monthEnd };
    case "weekly":
      return { view: "weekly", year: sel.year, from: b.weekStart, to: b.weekEnd };
    case "daily":
      return { view: "daily", year: sel.year, from: b.dailyWeek, to: b.dailyWeek };
  }
}

export function reportQuery(sel: AnalyticsSelection, paper: PaperSize, locale: string): ReportQuery {
  return { ...reportSelection(sel), paper, locale };
}

/** Query string in contract order: `view=weekly&year=2026&from=53&to=53&paper=A4&locale=nb-NO`. */
export function reportQueryString(query: ReportQuery): string {
  const params = new URLSearchParams();
  params.set("view", query.view);
  params.set("year", String(query.year));
  params.set("from", String(query.from));
  params.set("to", String(query.to));
  params.set("paper", query.paper);
  params.set("locale", query.locale);
  return params.toString();
}

/** Path (relative to the API base URL, which ends in /api) of the personal report. */
export function personalReportUrl(format: ReportFormat, query: ReportQuery): string {
  return `/reports/personal.${format}?${reportQueryString(query)}`;
}

/**
 * File name stem of an export for the selection, matching the server's naming:
 * `time-planner-analytics-2026-W40`, `…-2026-W38_2026-W41`, `…-2026-03`, `…-2026-01_2026-12`;
 * the Day view names its ISO week.
 */
export function reportFileStem(sel: AnalyticsSelection): string {
  const prefix = "time-planner-analytics";
  if (sel.view === "daily") {
    const week = normalizedBounds(sel).dailyWeek;
    return `${prefix}-${sel.year}-W${String(week).padStart(2, "0")}`;
  }
  const buckets = analyticsBuckets(sel);
  const first = buckets[0]?.key ?? String(sel.year);
  const last = buckets[buckets.length - 1]?.key ?? first;
  return first === last ? `${prefix}-${first}` : `${prefix}-${first}_${last}`;
}
