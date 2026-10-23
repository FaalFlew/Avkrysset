/**
 * Export state machine: loading → slow hint (3 s) → success | error | cancelled; the selection is
 * read at click time; repeat clicks are ignored; guest CSV is built in the browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import { AxiosHeaders } from "axios";
import {
  EXPORT_TIMEOUT_MS,
  SLOW_HINT_MS,
  responseHeader,
  useAnalyticsExport,
  type AnalyticsExportDeps,
  type ExportRequestConfig,
  type ExportResponse,
} from "../useAnalyticsExport";
import type { AnalyticsSelection } from "@/lib/analyticsBuckets";
import type { AnalyticsSnapshot } from "@/composables/useStats";
import type { PaperSize } from "@/lib/paper";
import { buildTaskListRows } from "@/lib/taskList";
import { combineDateAndTime, formatDateRange, formatWeekdayLong } from "@/lib/datetime";

interface Pending {
  url: string;
  config: ExportRequestConfig;
  resolve: (response: ExportResponse) => void;
  reject: (error: unknown) => void;
}

function setup(initial: Partial<AnalyticsSelection> = {}) {
  const selection: AnalyticsSelection = {
    view: "weekly",
    year: 2026,
    monthRange: { start: 0, end: 11 },
    weekRange: { start: 1, end: 53 },
    dailyWeek: 41,
    ...initial,
  };
  let paper: PaperSize = "A4";
  const pending: Pending[] = [];
  const deps: AnalyticsExportDeps = {
    get: vi.fn(
      (url: string, config: ExportRequestConfig) =>
        new Promise<ExportResponse>((resolve, reject) => {
          pending.push({ url, config, resolve, reject });
          // axios rejects with a CanceledError when the signal aborts
          config.signal.addEventListener("abort", () => reject({ code: "ERR_CANCELED", name: "CanceledError" }));
        })
    ),
    save: vi.fn(),
    announce: vi.fn(),
    notifyError: vi.fn(),
    today: () => "2026-10-11",
    locale: () => "nb-NO",
  };
  const scope = effectScope();
  const exporter = scope.run(() =>
    useAnalyticsExport({ selection: () => selection, paper: () => paper, deps })
  )!;
  return {
    exporter,
    deps,
    pending,
    selection,
    setPaper: (p: PaperSize) => (paper = p),
    scope,
  };
}

const pdfBlob = () => new Blob(["%PDF-1.7"], { type: "application/pdf" });
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  // Only timers: Blob.text()/arrayBuffer() must keep working.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useAnalyticsExport — server report", () => {
  it("loading → slow hint after 3 s → success: saves with the server's file name and announces", async () => {
    const { exporter, deps, pending } = setup();
    const done = exporter.downloadReport("pdf");

    expect(exporter.status.value).toBe("loading");
    expect(exporter.busy.value).toBe(true);
    expect(exporter.format.value).toBe("pdf");
    expect(exporter.slow.value).toBe(false);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.url).toBe("/reports/personal.pdf?view=weekly&year=2026&from=1&to=53&paper=A4&locale=nb-NO");
    expect(pending[0]!.config.responseType).toBe("blob");
    expect(pending[0]!.config.timeout).toBe(EXPORT_TIMEOUT_MS);
    expect(EXPORT_TIMEOUT_MS).toBe(90_000);

    vi.advanceTimersByTime(SLOW_HINT_MS - 1);
    expect(exporter.slow.value).toBe(false);
    vi.advanceTimersByTime(1);
    expect(exporter.slow.value).toBe(true);

    const blob = pdfBlob();
    pending[0]!.resolve({
      data: blob,
      headers: new AxiosHeaders({
        "content-disposition":
          "attachment; filename=\"time-planner-analytics-2026-W01_2026-W53.pdf\"; filename*=UTF-8''time-planner-analytics-2026-W01_2026-W53.pdf",
        "x-document-id": "TP-20261011-7K3M9QXA",
      }),
    });
    await expect(done).resolves.toBe("success");

    expect(deps.save).toHaveBeenCalledWith(blob, "time-planner-analytics-2026-W01_2026-W53.pdf");
    expect(deps.announce).toHaveBeenCalledWith("PDF downloaded");
    expect(deps.notifyError).not.toHaveBeenCalled();
    expect(exporter.status.value).toBe("success");
    expect(exporter.busy.value).toBe(false);
    expect(exporter.slow.value).toBe(false);
    expect(exporter.documentId.value).toBe("TP-20261011-7K3M9QXA");
  });

  it("reads the selection and paper at click time", async () => {
    const { exporter, pending, selection, setPaper } = setup();
    selection.view = "daily";
    selection.year = 2025;
    selection.dailyWeek = 1;
    setPaper("Letter");
    void exporter.downloadReport("csv");
    expect(pending[0]!.url).toBe("/reports/personal.csv?view=daily&year=2025&from=1&to=1&paper=Letter&locale=nb-NO");
    pending[0]!.resolve({ data: new Blob(["a"], { type: "text/csv" }), headers: {} });
    await flush();
  });

  it("ignores repeat clicks while an export is running", async () => {
    const { exporter, deps, pending } = setup();
    const first = exporter.downloadReport("pdf");
    await expect(exporter.downloadReport("pdf")).resolves.toBe("loading");
    await expect(exporter.downloadReport("csv")).resolves.toBe("loading");
    expect(deps.get).toHaveBeenCalledTimes(1);
    expect(exporter.format.value).toBe("pdf");
    pending[0]!.resolve({ data: pdfBlob(), headers: {} });
    await first;
    // a new export can start afterwards
    void exporter.downloadReport("csv");
    expect(deps.get).toHaveBeenCalledTimes(2);
  });

  it("falls back to a dated file name without Content-Disposition", async () => {
    const { exporter, deps, pending } = setup({ view: "monthly" });
    const done = exporter.downloadReport("csv");
    pending[0]!.resolve({ data: new Blob(["﻿x"], { type: "text/csv" }), headers: { "X-Document-Id": "TP-1" } });
    await done;
    expect(deps.save).toHaveBeenCalledWith(expect.any(Blob), "time-planner-analytics-monthly-2026-10-11.csv");
    expect(deps.announce).toHaveBeenCalledWith("CSV downloaded");
  });

  it("cancel aborts the request: cancelled, announced, no toast, hint gone", async () => {
    const { exporter, deps, pending } = setup();
    const done = exporter.downloadReport("pdf");
    vi.advanceTimersByTime(SLOW_HINT_MS);
    expect(exporter.slow.value).toBe(true);

    exporter.cancel();
    expect(pending[0]!.config.signal.aborted).toBe(true);
    await expect(done).resolves.toBe("cancelled");
    expect(exporter.status.value).toBe("cancelled");
    expect(exporter.slow.value).toBe(false);
    expect(exporter.busy.value).toBe(false);
    expect(deps.announce).toHaveBeenCalledWith("Export cancelled");
    expect(deps.notifyError).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("errors: 429 with a Blob body and Retry-After → toast with the wait", async () => {
    const { exporter, deps, pending } = setup();
    const done = exporter.downloadReport("pdf");
    pending[0]!.reject({
      response: {
        status: 429,
        data: new Blob([JSON.stringify({ message: "Too many requests", errors: {} })], { type: "application/json" }),
        headers: new AxiosHeaders({ "Retry-After": "30" }),
      },
      request: {},
    });
    await expect(done).resolves.toBe("error");
    expect(deps.notifyError).toHaveBeenCalledWith("Too many exports — try again in 30s.");
    expect(exporter.lastError.value).toBe("Too many exports — try again in 30s.");
    expect(exporter.busy.value).toBe(false);
  });

  it("errors: 400 shows the server's message from the Blob body", async () => {
    const { exporter, deps, pending } = setup();
    const done = exporter.downloadReport("csv");
    pending[0]!.reject({
      response: {
        status: 400,
        data: new Blob([JSON.stringify({ message: "Invalid selection.", errors: { from: ["must be ≤ to"] } })]),
        headers: {},
      },
    });
    await done;
    expect(deps.notifyError).toHaveBeenCalledWith("Invalid selection.");
  });

  it("errors: timeout and network", async () => {
    const { exporter, deps, pending } = setup();
    let done = exporter.downloadReport("pdf");
    pending[0]!.reject({ code: "ECONNABORTED", message: "timeout of 90000ms exceeded", request: {} });
    await done;
    expect(deps.notifyError).toHaveBeenLastCalledWith("The export took too long. Please try again.");

    done = exporter.downloadReport("pdf");
    pending[1]!.reject({ code: "ERR_NETWORK", request: {} });
    await done;
    expect(deps.notifyError).toHaveBeenLastCalledWith("Can't reach the server. Check your connection and try again.");
  });

  it("refuses to save an HTML page or an empty body", async () => {
    const { exporter, deps, pending } = setup();
    let done = exporter.downloadReport("pdf");
    pending[0]!.resolve({ data: new Blob(["<!doctype html>"], { type: "text/html" }), headers: {} });
    await expect(done).resolves.toBe("error");
    done = exporter.downloadReport("pdf");
    pending[1]!.resolve({ data: new Blob([]), headers: {} });
    await expect(done).resolves.toBe("error");
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.notifyError).toHaveBeenCalledWith("Couldn't export the PDF. Please try again.");
  });

  it("disposing the scope (page unmount) aborts a running export", async () => {
    const { exporter, pending, scope, deps } = setup();
    const done = exporter.downloadReport("pdf");
    scope.stop();
    await expect(done).resolves.toBe("cancelled");
    expect(pending[0]!.config.signal.aborted).toBe(true);
    expect(deps.save).not.toHaveBeenCalled();
  });
});

describe("useAnalyticsExport — task list CSV", () => {
  it("signed in: GET personal.tasks.csv for the selection (no paper), saved under the server's name", async () => {
    const { exporter, deps, pending } = setup({ view: "weekly", weekRange: { start: 40, end: 42 } });
    const done = exporter.downloadReport("tasks-csv");
    expect(exporter.format.value).toBe("tasks-csv");
    expect(pending[0]!.url).toBe("/reports/personal.tasks.csv?view=weekly&year=2026&from=40&to=42&locale=nb-NO");
    expect(pending[0]!.config.responseType).toBe("blob");
    const blob = new Blob(["﻿# Time Planner task list export\r\n"], { type: "text/csv" });
    pending[0]!.resolve({
      data: blob,
      headers: new AxiosHeaders({
        "content-disposition": "attachment; filename=time-planner-tasks-2026-W40_2026-W42.csv",
        "x-document-id": "TP-20261017-ABCDEFGH",
      }),
    });
    await expect(done).resolves.toBe("success");
    expect(deps.save).toHaveBeenCalledWith(blob, "time-planner-tasks-2026-W40_2026-W42.csv");
    expect(deps.announce).toHaveBeenCalledWith("Task list downloaded");
    expect(exporter.documentId.value).toBe("TP-20261017-ABCDEFGH");
  });

  it("signed in: falls back to a dated task file name; errors name the task list", async () => {
    const { exporter, deps, pending } = setup({ view: "daily", dailyWeek: 43 });
    let done = exporter.downloadReport("tasks-csv");
    expect(pending[0]!.url).toBe("/reports/personal.tasks.csv?view=daily&year=2026&from=43&to=43&locale=nb-NO");
    pending[0]!.resolve({ data: new Blob(["x"], { type: "text/csv" }), headers: {} });
    await done;
    expect(deps.save).toHaveBeenCalledWith(expect.any(Blob), "time-planner-tasks-daily-2026-10-11.csv");

    done = exporter.downloadReport("tasks-csv");
    pending[1]!.reject({ response: { status: 500, data: new Blob(["{}"]), headers: {} } });
    await expect(done).resolves.toBe("error");
    expect(deps.notifyError).toHaveBeenCalledWith(
      "Couldn't create the task list — something went wrong on our side. Please try again."
    );
  });

  it("guest: builds the task list CSV in the browser (nb-NO) and saves it as time-planner-tasks-…", async () => {
    const { exporter, deps } = setup();
    const selection: AnalyticsSelection = {
      view: "weekly",
      year: 2026,
      monthRange: { start: 0, end: 11 },
      weekRange: { start: 42, end: 42 },
      dailyWeek: 42,
    };
    const rows = buildTaskListRows(
      [
        {
          id: "t1",
          title: "Plan; review",
          start: combineDateAndTime("2026-10-14", "09:00"),
          duration: 1.5,
          categoryId: "c1",
          categoryName: "Work",
          categoryColor: "#2F7FE0",
        },
      ],
      { categories: [], templates: [], currentUserId: null }
    );
    expect(
      exporter.downloadGuestTaskCsv(rows, selection, {
        timeZoneLabel: "UTC",
        generatedAt: "2026-10-17 10:00 (UTC)",
      })
    ).toBe(true);
    expect(deps.get).not.toHaveBeenCalled();
    const [blob, filename] = (deps.save as ReturnType<typeof vi.fn>).mock.calls[0]! as [Blob, string];
    expect(filename).toBe("time-planner-tasks-2026-W42.csv");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(text).toContain("# Time Planner task list export\r\n");
    // One locale (deps.locale() = nb-NO) for the delimiter, the decimal, the weekday and the range label.
    expect(text).toContain(`# Range: Week 42 · ${formatDateRange("2026-10-12", "2026-10-18", "nb-NO")}\r\n`);
    expect(formatWeekdayLong("2026-10-14", "nb-NO")).toBe("onsdag");
    expect(text).toContain(
      `2026-10-14;onsdag;09:00;10:30;2026-10-14;1,50;1:30;"Plan; review";Work;;;You;;\r\n`
    );
    expect(deps.announce).toHaveBeenCalledWith("Task list downloaded");
  });
});

describe("useAnalyticsExport — guest CSV", () => {
  it("builds the CSV in the browser and saves it under the selection's name", async () => {
    const { exporter, deps } = setup();
    const selection: AnalyticsSelection = {
      view: "monthly",
      year: 2026,
      monthRange: { start: 2, end: 2 },
      weekRange: { start: 1, end: 53 },
      dailyWeek: 1,
    };
    const snapshot: AnalyticsSnapshot = {
      selection,
      periods: [{ key: "2026-03", label: "Mar", fullLabel: "March 2026", hours: 2.5, categories: [], topCategory: "Work" }],
      sparse: false,
      categories: [{ id: "c1", name: "Work", color: null, hours: 2.5, share: 1 }],
      templates: [],
      untemplatedHours: 2.5,
      totalHours: 2.5,
      taskCount: 2,
      activeDays: 1,
    };
    expect(
      exporter.downloadGuestCsv(snapshot, { rangeLabel: "March 2026 · 1 month", timeZoneLabel: "UTC", generatedAt: "Oct 11, 2026, 14:05" })
    ).toBe(true);
    expect(deps.get).not.toHaveBeenCalled();
    const [blob, filename] = (deps.save as ReturnType<typeof vi.fn>).mock.calls[0]! as [Blob, string];
    expect(filename).toBe("time-planner-analytics-2026-03.csv");
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    // nb-NO: ';' + decimal comma
    expect(text).toContain("Section;Key;Label;Category;Hours;Share %\r\n");
    expect(text).toContain("Period;2026-03;March 2026;;2,50;100,0\r\n");
    expect(text).not.toContain("Document ID");
    expect(deps.announce).toHaveBeenCalledWith("CSV downloaded");
  });
});

describe("responseHeader", () => {
  it("reads AxiosHeaders and plain objects case-insensitively", () => {
    expect(responseHeader(new AxiosHeaders({ "Content-Disposition": "attachment" }), "content-disposition")).toBe("attachment");
    expect(responseHeader({ "X-Document-Id": "TP-1" }, "x-document-id")).toBe("TP-1");
    expect(responseHeader({ "x-document-id": ["TP-2", "TP-3"] }, "X-Document-Id")).toBe("TP-2");
    expect(responseHeader(undefined, "x")).toBeNull();
    expect(responseHeader({}, "x")).toBeNull();
  });
});
