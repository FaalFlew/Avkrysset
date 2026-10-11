/** Export error copy, including JSON error bodies delivered as Blobs and 429 Retry-After. */
import { describe, expect, it } from "vitest";
import { NETWORK_ERROR_MESSAGE, readBlobError } from "../apiErrors";
import {
  EXPORT_FORBIDDEN_MESSAGE,
  EXPORT_NOT_AVAILABLE_MESSAGE,
  EXPORT_RATE_LIMIT_MESSAGE,
  EXPORT_SESSION_MESSAGE,
  EXPORT_TIMEOUT_MESSAGE,
  exportErrorMessage,
  isCancelledRequest,
} from "../exportErrors";
import { parseApiInstant } from "../datetime";

const jsonBlob = (body: unknown) => new Blob([JSON.stringify(body)], { type: "application/json" });

const blobError = (status: number, body?: unknown, headers: Record<string, string> = {}) => ({
  response: { status, data: body === undefined ? new Blob([]) : jsonBlob(body), headers },
  request: {},
});

async function messageOf(error: unknown, format: "pdf" | "csv" = "pdf", nowMs?: number) {
  return exportErrorMessage(await readBlobError(error), format, nowMs);
}

describe("exportErrorMessage", () => {
  it("400 → the server's message from the Blob body", async () => {
    const error = blobError(400, { message: "The range can be at most 400 days.", errors: { to: ["too far"] } });
    expect(await messageOf(error)).toBe("The range can be at most 400 days.");
  });

  it("400 without a message → a format-specific fallback", async () => {
    expect(await messageOf(blobError(400), "csv")).toBe("Couldn't export the CSV for this range. Please try again.");
    expect(await messageOf({ response: { status: 422, data: new Blob(["<html>bad</html>"]) } })).toBe(
      "Couldn't export the PDF for this range. Please try again."
    );
  });

  it("401 → session copy", async () => {
    expect(await messageOf(blobError(401, { message: "Unauthorized" }))).toBe(EXPORT_SESSION_MESSAGE);
  });

  it("403 → permission copy, never the server's wording", async () => {
    expect(await messageOf(blobError(403, { message: "Member 42 cannot export org 7" }))).toBe(EXPORT_FORBIDDEN_MESSAGE);
  });

  it("404 → the server's message, else 'not available'", async () => {
    expect(await messageOf(blobError(404, { message: "Organization not found." }))).toBe("Organization not found.");
    expect(await messageOf(blobError(404))).toBe(EXPORT_NOT_AVAILABLE_MESSAGE);
  });

  it("429 → 'try again in {n}s' from Retry-After (seconds or HTTP-date)", async () => {
    expect(await messageOf(blobError(429, { message: "slow down" }, { "retry-after": "30" }))).toBe(
      "Too many exports — try again in 30s."
    );
    const nowMs = parseApiInstant("2026-10-21T07:27:15Z");
    expect(
      await messageOf(blobError(429, undefined, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }), "csv", nowMs)
    ).toBe("Too many exports — try again in 45s.");
    expect(await messageOf(blobError(429))).toBe(EXPORT_RATE_LIMIT_MESSAGE);
    expect(await messageOf(blobError(429, undefined, { "retry-after": "0" }))).toBe(EXPORT_RATE_LIMIT_MESSAGE);
  });

  it("reads Retry-After from AxiosHeaders-like objects", async () => {
    const headers = { get: (name: string) => (name.toLowerCase() === "retry-after" ? "12" : undefined) };
    expect(await messageOf({ response: { status: 429, data: new Blob([]), headers } })).toBe(
      "Too many exports — try again in 12s."
    );
  });

  it("5xx → generic server copy naming the format", async () => {
    expect(await messageOf(blobError(500, { message: "NullReferenceException at …" }))).toBe(
      "Couldn't create the PDF — something went wrong on our side. Please try again."
    );
    expect(await messageOf(blobError(503), "csv")).toBe(
      "Couldn't create the CSV — something went wrong on our side. Please try again."
    );
  });

  it("timeout and network failures", async () => {
    expect(await messageOf({ code: "ECONNABORTED", request: {} })).toBe(EXPORT_TIMEOUT_MESSAGE);
    expect(await messageOf({ code: "ETIMEDOUT", request: {} })).toBe(EXPORT_TIMEOUT_MESSAGE);
    expect(await messageOf({ code: "ERR_NETWORK", request: {} })).toBe(NETWORK_ERROR_MESSAGE);
    expect(await messageOf({ request: {} })).toBe(NETWORK_ERROR_MESSAGE);
  });

  it("other failures → a generic export message", async () => {
    expect(await messageOf(new Error("The server did not send a file."))).toBe("Couldn't export the PDF. Please try again.");
  });

  it("cancelled requests → null (nothing to show)", async () => {
    expect(await messageOf({ code: "ERR_CANCELED", message: "canceled" })).toBeNull();
    expect(isCancelledRequest({ name: "CanceledError" })).toBe(true);
    expect(isCancelledRequest({ name: "AbortError" })).toBe(true);
    expect(isCancelledRequest({ __CANCEL__: true })).toBe(true);
    expect(isCancelledRequest(blobError(500))).toBe(false);
    expect(isCancelledRequest(null)).toBe(false);
  });
});
