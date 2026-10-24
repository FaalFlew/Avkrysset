// src/composables/useAnalyticsExport.ts — exporting the analytics page.
//
// Signed in: the server renders the report (PDF/CSV) for the SELECTION read from the page's
// filters at click time (src/lib/reportQuery.ts); the browser only saves the file.
//   idle → loading ("Preparing PDF…", repeat clicks ignored) → after 3 s `slow` ("Waking up the
//   server…" + Cancel) → success (announced) | error (toast) | cancelled (AbortController).
// Guests: the CSV is built in the browser from the on-screen snapshot (src/lib/analyticsCsv.ts),
// the task list CSV from the local tasks (src/lib/taskListCsv.ts).
// Printing is handled by usePrintMode.

import { computed, getCurrentScope, onScopeDispose, readonly, ref } from "vue";
import { analyticsBuckets, type AnalyticsSelection } from "@/lib/analyticsBuckets";
import { selectionSummary } from "@/components/analytics/format";
import type { AnalyticsSnapshot } from "@/composables/useStats";
import { readBlobError } from "@/lib/apiErrors";
import {
  analyticsCsvInputFromSnapshot,
  buildAnalyticsCsv,
  csvFormatForLocale,
  type CsvMeta,
} from "@/lib/analyticsCsv";
import { todayKey, type DateKey } from "@/lib/datetime";
import { fallbackExportFileName, parseContentDisposition, saveBlob } from "@/lib/download";
import { exportErrorMessage, formatLabelSentence } from "@/lib/exportErrors";
import { browserLocale, type PaperSize } from "@/lib/paper";
import {
  ANALYTICS_FILE_PREFIX,
  TASKS_FILE_PREFIX,
  exportUrl,
  reportFileStem,
  reportQuery,
  type ExportKind,
} from "@/lib/reportQuery";
import { buildTaskListCsv, taskListCsvRows, type TaskListCsvMeta } from "@/lib/taskListCsv";
import type { TaskListRow } from "@/lib/taskList";
import apiService from "@/services/apiService";
import { useUIStore } from "@/stores/uiStore";

/** When the "Waking up the server…" hint (and Cancel) appears. */
export const SLOW_HINT_MS = 3_000;
/** Request timeout for a report (cold starts + rendering). */
export const EXPORT_TIMEOUT_MS = 90_000;

export type ExportStatus = "idle" | "loading" | "success" | "error" | "cancelled";

export interface ExportRequestConfig {
  responseType: "blob";
  timeout: number;
  signal: AbortSignal;
}

export interface ExportResponse {
  data: Blob;
  headers?: unknown;
}

export interface AnalyticsExportDeps {
  /** GET with the app's axios instance (auth, X-Time-Zone, 401 refresh). */
  get: (url: string, config: ExportRequestConfig) => Promise<ExportResponse>;
  save: (blob: Blob, filename: string) => void;
  announce: (message: string) => void;
  notifyError: (message: string) => void;
  today: () => DateKey;
  locale: () => string;
}

export interface UseAnalyticsExportOptions {
  /** The page's current filters (read at click time). */
  selection: () => AnalyticsSelection;
  paper: () => PaperSize;
  deps?: Partial<AnalyticsExportDeps>;
}

function defaultDeps(): AnalyticsExportDeps {
  return {
    get: (url, config) => apiService.get<Blob>(url, config),
    save: (blob, filename) => saveBlob(blob, filename),
    announce: (message) => useUIStore().announce(message),
    notifyError: (message) => useUIStore().showToast(message, "error", 6000),
    today: () => todayKey(),
    locale: () => browserLocale(),
  };
}

/** A header from axios' AxiosHeaders (get()) or a plain object, case-insensitive. */
export function responseHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  const getter = (headers as { get?: (n: string) => unknown }).get;
  let value: unknown =
    typeof getter === "function"
      ? getter.call(headers, name)
      : Object.entries(headers as Record<string, unknown>).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
  if (Array.isArray(value)) value = value[0];
  return value === undefined || value === null || value === false ? null : String(value);
}

/** A 200 that is not a file (e.g. an HTML fallback page from a proxy) must not be saved. */
function isUnexpectedBody(blob: unknown): boolean {
  if (!blob || typeof blob !== "object" || typeof (blob as Blob).size !== "number") return true;
  const b = blob as Blob;
  return b.size === 0 || /text\/html/i.test(b.type ?? "");
}

export function useAnalyticsExport(options: UseAnalyticsExportOptions) {
  const deps: AnalyticsExportDeps = { ...defaultDeps(), ...options.deps };

  const status = ref<ExportStatus>("idle");
  const format = ref<ExportKind | null>(null);
  const slow = ref(false);
  const lastError = ref<string | null>(null);
  const documentId = ref<string | null>(null);
  const busy = computed(() => status.value === "loading");

  let controller: AbortController | null = null;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;

  function clearSlowTimer(): void {
    if (slowTimer !== undefined) clearTimeout(slowTimer);
    slowTimer = undefined;
    slow.value = false;
  }

  /**
   * Download a server-rendered export (report PDF/CSV, or the task list CSV). Ignored while
   * another export is running.
   */
  async function downloadReport(fmt: ExportKind): Promise<ExportStatus> {
    if (status.value === "loading") return "loading";
    const selection = options.selection();
    const query = reportQuery(selection, options.paper(), deps.locale());
    const request = new AbortController();
    controller = request;
    status.value = "loading";
    format.value = fmt;
    lastError.value = null;
    clearSlowTimer();
    slowTimer = setTimeout(() => {
      if (controller === request) slow.value = true;
    }, SLOW_HINT_MS);

    try {
      const response = await deps.get(exportUrl(fmt, query), {
        responseType: "blob",
        timeout: EXPORT_TIMEOUT_MS,
        signal: request.signal,
      });
      if (request.signal.aborted) throw { code: "ERR_CANCELED" };
      if (isUnexpectedBody(response.data)) throw new Error("The server did not send a file.");
      const filename =
        parseContentDisposition(responseHeader(response.headers, "content-disposition")) ??
        fallbackExportFileName(
          selection.view,
          fmt === "pdf" ? "pdf" : "csv",
          deps.today(),
          fmt === "tasks-csv" ? TASKS_FILE_PREFIX : ANALYTICS_FILE_PREFIX
        );
      deps.save(response.data, filename);
      documentId.value = responseHeader(response.headers, "x-document-id");
      status.value = "success";
      deps.announce(`${formatLabelSentence(fmt)} downloaded`);
    } catch (error) {
      const readable = await readBlobError(error);
      const message = exportErrorMessage(readable, fmt);
      if (message === null) {
        status.value = "cancelled";
        deps.announce("Export cancelled");
      } else {
        status.value = "error";
        lastError.value = message;
        deps.notifyError(message);
      }
    } finally {
      if (controller === request) controller = null;
      clearSlowTimer();
    }
    return status.value;
  }

  /** Abort the running export (the "Cancel" next to the slow-server hint). */
  function cancel(): void {
    controller?.abort();
  }

  /** Guest CSV: built from the on-screen snapshot and saved right away. Returns success. */
  function downloadGuestCsv(snapshot: AnalyticsSnapshot, meta: CsvMeta): boolean {
    try {
      const csv = buildAnalyticsCsv(analyticsCsvInputFromSnapshot(snapshot, meta), csvFormatForLocale(deps.locale()));
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      deps.save(blob, `${reportFileStem(snapshot.selection)}.csv`);
      format.value = "csv";
      status.value = "success";
      deps.announce("CSV downloaded");
      return true;
    } catch (error) {
      console.error("Could not create the CSV file:", error);
      status.value = "error";
      lastError.value = "Couldn't create the CSV file. Please try again.";
      deps.notifyError(lastError.value);
      return false;
    }
  }

  /**
   * Guest task list CSV: built from the local tasks of the range and saved right away. Everything
   * localized in it (delimiter, decimal, weekday names, the range label) follows deps.locale().
   */
  function downloadGuestTaskCsv(
    rows: readonly TaskListRow[],
    selection: AnalyticsSelection,
    meta: Omit<TaskListCsvMeta, "rangeLabel">
  ): boolean {
    try {
      const locale = deps.locale();
      const rangeLabel = selectionSummary(selection, analyticsBuckets(selection).length, locale);
      const csv = buildTaskListCsv(taskListCsvRows(rows), { ...meta, rangeLabel }, locale);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      deps.save(blob, `${reportFileStem(selection, TASKS_FILE_PREFIX)}.csv`);
      format.value = "tasks-csv";
      status.value = "success";
      deps.announce("Task list downloaded");
      return true;
    } catch (error) {
      console.error("Could not create the task list CSV:", error);
      status.value = "error";
      lastError.value = "Couldn't create the task list. Please try again.";
      deps.notifyError(lastError.value);
      return false;
    }
  }

  if (getCurrentScope()) onScopeDispose(cancel);

  return {
    status: readonly(status),
    format: readonly(format),
    /** The export has been running for SLOW_HINT_MS: show "Waking up the server…" + Cancel. */
    slow: readonly(slow),
    busy,
    lastError: readonly(lastError),
    /** `X-Document-Id` of the last downloaded report. */
    documentId: readonly(documentId),
    downloadReport,
    downloadGuestCsv,
    downloadGuestTaskCsv,
    cancel,
  };
}
