// src/lib/exportErrors.ts — user-facing copy for failed report exports. Errors of blob requests
// carry their JSON body as a Blob: run readBlobError() (apiErrors.ts) before calling this.

import {
  NETWORK_ERROR_MESSAGE,
  httpStatus,
  isSessionChangedError,
  retryAfterSeconds,
  serverMessage,
  type ApiErrorLike,
} from "@/lib/apiErrors";
import { now } from "@/lib/datetime";
import type { ExportKind } from "@/lib/reportQuery";

export const EXPORT_FORBIDDEN_MESSAGE = "You don't have permission to export this report.";
export const EXPORT_SESSION_MESSAGE = "Your session has expired. Sign in again to export.";
export const EXPORT_TIMEOUT_MESSAGE = "The export took too long. Please try again.";
export const EXPORT_RATE_LIMIT_MESSAGE = "Too many exports. Please wait a moment and try again.";
export const EXPORT_NOT_AVAILABLE_MESSAGE = "Exports aren't available right now. Please try again later.";

/** How messages name an export: "PDF", "CSV", "task list". */
export const formatLabel = (format: ExportKind) =>
  format === "pdf" ? "PDF" : format === "csv" ? "CSV" : "task list";

/** {@link formatLabel} at the start of a sentence: "PDF", "CSV", "Task list". */
export const formatLabelSentence = (format: ExportKind) => {
  const label = formatLabel(format);
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/**
 * True when the request was cancelled (AbortController / axios CanceledError), or dropped because
 * the user logged out meanwhile (SessionChangedError): nothing to report either way.
 */
export function isCancelledRequest(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (isSessionChangedError(error)) return true;
  const e = error as ApiErrorLike & { name?: string; __CANCEL__?: boolean };
  return e.code === "ERR_CANCELED" || e.name === "CanceledError" || e.name === "AbortError" || e.__CANCEL__ === true;
}

/**
 * Copy for a failed export, or null when it was cancelled (nothing to show).
 * 400 → the server's message · 401 → session copy · 403 → permission copy ·
 * 404 → "not available" (or the server's message) · 429 → "Too many exports — try again in 12s." ·
 * 5xx → "Couldn't create the PDF…" · timeout · network.
 */
export function exportErrorMessage(error: unknown, format: ExportKind, nowMs: number = now()): string | null {
  if (isCancelledRequest(error)) return null;
  const label = formatLabel(format);
  const status = httpStatus(error);
  if (status === null) {
    const e = (error && typeof error === "object" ? error : {}) as ApiErrorLike;
    if (e.code === "ECONNABORTED" || e.code === "ETIMEDOUT") return EXPORT_TIMEOUT_MESSAGE;
    if (e.request !== undefined || e.code === "ERR_NETWORK") return NETWORK_ERROR_MESSAGE;
    return `Couldn't export the ${label}. Please try again.`;
  }
  if (status === 401) return EXPORT_SESSION_MESSAGE;
  if (status === 403) return EXPORT_FORBIDDEN_MESSAGE;
  if (status === 429) {
    const seconds = retryAfterSeconds(error, nowMs);
    return seconds !== null && seconds > 0 ? `Too many exports — try again in ${seconds}s.` : EXPORT_RATE_LIMIT_MESSAGE;
  }
  if (status >= 500) return `Couldn't create the ${label} — something went wrong on our side. Please try again.`;
  if (status === 404) return serverMessage(error) ?? EXPORT_NOT_AVAILABLE_MESSAGE;
  return serverMessage(error) ?? `Couldn't export the ${label} for this range. Please try again.`;
}
