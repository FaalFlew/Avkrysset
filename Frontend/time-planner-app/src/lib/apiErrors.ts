// src/lib/apiErrors.ts — user-facing copy for failed API requests (shared by stores, export, org UI).
//
// Rules (status → copy):
//   403        "You don't have permission to do that." (server messages for permissions are not
//              shown verbatim: they can name internals)
//   404/400/409/422 and other 4xx: the server's `message` verbatim when it sent one (overlap
//              rule, validation, "not found"), else the caller's fallback
//   429        "Too many requests — try again in 12s." (Retry-After seconds or HTTP-date)
//   5xx        generic "Something went wrong on our side."
//   no response: timeout copy (ECONNABORTED / ETIMEDOUT) or the network copy
// Blob responses (file downloads) carry their JSON error body as a Blob: run readBlobError()
// first, then apiErrorMessage().
// SessionChangedError (a response for a session that has ended) is never shown: check
// isSessionChangedError() first and stay silent.

import { now, parseApiInstant } from "@/lib/datetime";

export const NETWORK_ERROR_MESSAGE = "Can't reach the server. Check your connection and try again.";
export const FORBIDDEN_MESSAGE = "You don't have permission to do that.";
export const TIMEOUT_MESSAGE = "The server took too long to respond. Please try again.";
export const SERVER_ERROR_MESSAGE = "Something went wrong on our side. Please try again.";
export const RATE_LIMIT_MESSAGE = "Too many requests. Please wait a moment and try again.";

/** The parts of an axios error this module reads. */
export interface ApiErrorLike {
  response?: {
    status?: number;
    data?: unknown;
    headers?: Record<string, unknown> | { get?: (name: string) => unknown };
  };
  request?: unknown;
  code?: string;
}

function asApiError(error: unknown): ApiErrorLike {
  return (error && typeof error === "object" ? error : {}) as ApiErrorLike;
}

/** HTTP status of a failed request, or null when there was no response. */
export function httpStatus(error: unknown): number | null {
  const status = asApiError(error).response?.status;
  return typeof status === "number" ? status : null;
}

/**
 * The request belonged to a session that has ended (logout, or a new login) before it settled.
 * The API layer rejects such responses and retries with this error before any caller sees them,
 * so data of one session can never land in another. Callers stay silent: no toast, no state change.
 */
export class SessionChangedError extends Error {
  readonly isSessionChanged = true;

  constructor(message = "The session changed while this request was running.") {
    super(message);
    this.name = "SessionChangedError";
  }
}

export function isSessionChangedError(error: unknown): error is SessionChangedError {
  return (
    error instanceof SessionChangedError ||
    (!!error && typeof error === "object" && (error as { isSessionChanged?: unknown }).isSessionChanged === true)
  );
}

/**
 * The server refused a token refresh (400/401/403): the refresh token is invalid, expired or
 * revoked, so the session is over. Anything else — no response, timeout, 408, 429, 5xx — is
 * transient: keep the session and try the refresh again on the next request.
 */
export function isRefreshRefused(error: unknown): boolean {
  const status = httpStatus(error);
  return status === 400 || status === 401 || status === 403;
}

export const isForbidden = (error: unknown) => httpStatus(error) === 403;
export const isNotFound = (error: unknown) => httpStatus(error) === 404;
export const isConflict = (error: unknown) => httpStatus(error) === 409;
export const isBadRequest = (error: unknown) => httpStatus(error) === 400;

/** The server's `{ message }` text, if any. */
export function serverMessage(error: unknown): string | null {
  const data = asApiError(error).response?.data;
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof data === "string" && data.trim() && data.trim().length < 300 && !data.trim().startsWith("<")) {
    return data.trim(); // e.g. BadRequest("Route parameters must match the command body.")
  }
  return null;
}

function headerValue(error: unknown, name: string): string | null {
  const headers = asApiError(error).response?.headers;
  if (!headers) return null;
  const getter = (headers as { get?: (name: string) => unknown }).get;
  const wanted = name.toLowerCase();
  let value: unknown =
    typeof getter === "function"
      ? getter.call(headers, name)
      : Object.entries(headers as Record<string, unknown>).find(([key]) => key.toLowerCase() === wanted)?.[1];
  if (Array.isArray(value)) value = value[0];
  return value === undefined || value === null ? null : String(value);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const HTTP_DATE = /^\s*(?:[A-Za-z]{3},\s*)?(\d{1,2})[\s-]([A-Za-z]{3})[\s-](\d{2,4})\s+(\d{2}):(\d{2}):(\d{2})\s*GMT\s*$/;

/**
 * Seconds to wait from a `Retry-After` header: delta-seconds ("120") or an HTTP-date
 * ("Wed, 21 Oct 2026 07:28:00 GMT", parsed without native Date via datetime.ts). Null when absent
 * or unreadable; never negative.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number = now()): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const m = HTTP_DATE.exec(trimmed);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  if (month === -1) return null;
  let year = Number(m[3]);
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const iso = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}T${m[4]}:${m[5]}:${m[6]}Z`;
  try {
    return Math.max(0, Math.ceil((parseApiInstant(iso) - nowMs) / 1000));
  } catch {
    return null;
  }
}

/** Retry-After of a failed request in seconds, or null. */
export function retryAfterSeconds(error: unknown, nowMs: number = now()): number | null {
  return parseRetryAfter(headerValue(error, "retry-after"), nowMs);
}

/**
 * User-facing text for a failed request. `fallback` is used for 4xx without a server message
 * (and for cancelled requests).
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const e = asApiError(error);
  const status = httpStatus(error);

  if (status === null) {
    if (e.code === "ERR_CANCELED") return fallback;
    if (e.code === "ECONNABORTED" || e.code === "ETIMEDOUT") return TIMEOUT_MESSAGE;
    if (e.request !== undefined || e.code === "ERR_NETWORK") return NETWORK_ERROR_MESSAGE;
    return fallback;
  }
  if (status === 403) return FORBIDDEN_MESSAGE;
  if (status === 429) {
    const seconds = retryAfterSeconds(error);
    return seconds !== null && seconds > 0 ? `Too many requests — try again in ${seconds}s.` : RATE_LIMIT_MESSAGE;
  }
  if (status >= 500) return SERVER_ERROR_MESSAGE;
  return serverMessage(error) ?? fallback;
}

/** Blob-like body (Blob in browsers; anything with text() in tests). */
interface BlobLike {
  text: () => Promise<string>;
  type?: string;
}

function isBlobLike(value: unknown): value is BlobLike {
  return !!value && typeof value === "object" && typeof (value as BlobLike).text === "function";
}

/**
 * For requests made with `responseType: 'blob'` the error body (`{ message, errors }`) arrives
 * as a Blob. Returns the error with `response.data` replaced by the parsed JSON (or the text),
 * so apiErrorMessage() / serverMessage() work on it. Other errors are returned unchanged.
 */
export async function readBlobError<T>(error: T): Promise<T> {
  const e = asApiError(error);
  const data = e.response?.data;
  if (!e.response || !isBlobLike(data)) return error;
  let parsed: unknown = null;
  try {
    const text = await data.text();
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  } catch {
    parsed = null;
  }
  return { ...(error as object), response: { ...e.response, data: parsed } } as T;
}

const ORG_URL = /\/organizations\/([0-9a-fA-F-]{36})(?:\/|$|\?)/;

/** The organization id in an API url like `/organizations/{id}/tasks`, or null. */
export function organizationIdFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  return ORG_URL.exec(url)?.[1] ?? null;
}
