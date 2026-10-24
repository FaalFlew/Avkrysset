/** API error copy: status → message, Retry-After, blob error bodies, org ids in URLs. */
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  RATE_LIMIT_MESSAGE,
  SERVER_ERROR_MESSAGE,
  TIMEOUT_MESSAGE,
  apiErrorMessage,
  httpStatus,
  organizationIdFromUrl,
  parseRetryAfter,
  readBlobError,
  retryAfterSeconds,
} from "@/lib/apiErrors";
import { parseApiInstant } from "@/lib/datetime";

const response = (status: number, data?: unknown, headers: Record<string, string> = {}) => ({
  response: { status, data, headers },
});

describe("apiErrorMessage", () => {
  it("403 → permission copy (never the server's wording)", () => {
    expect(apiErrorMessage(response(403, { message: "You do not have permission to create issues in this organization." }), "x")).toBe(
      FORBIDDEN_MESSAGE
    );
    expect(FORBIDDEN_MESSAGE).toBe("You don't have permission to do that.");
  });

  it("404/400/409 → the server's message verbatim, else the fallback", () => {
    expect(apiErrorMessage(response(404, { message: "Organization not found." }), "x")).toBe("Organization not found.");
    expect(apiErrorMessage(response(409, { message: "This time overlaps a task assigned to you in Acme" }), "x")).toBe(
      "This time overlaps a task assigned to you in Acme"
    );
    expect(apiErrorMessage(response(400, "Route parameters must match the command body."), "x")).toBe(
      "Route parameters must match the command body."
    );
    expect(apiErrorMessage(response(404), "Couldn't find it.")).toBe("Couldn't find it.");
    expect(apiErrorMessage(response(400, "<html>oops</html>"), "Fallback")).toBe("Fallback");
  });

  it("429 → retry hint with Retry-After seconds", () => {
    expect(apiErrorMessage(response(429, { message: "slow down" }, { "retry-after": "12" }), "x")).toBe(
      "Too many requests — try again in 12s."
    );
    expect(apiErrorMessage(response(429), "x")).toBe(RATE_LIMIT_MESSAGE);
  });

  it("5xx → generic server copy", () => {
    expect(apiErrorMessage(response(500, { message: "An unexpected error has occurred." }), "x")).toBe(SERVER_ERROR_MESSAGE);
    expect(apiErrorMessage(response(503), "x")).toBe(SERVER_ERROR_MESSAGE);
  });

  it("no response → network or timeout copy; cancelled → fallback", () => {
    expect(apiErrorMessage({ request: {}, code: "ERR_NETWORK" }, "x")).toBe(NETWORK_ERROR_MESSAGE);
    expect(apiErrorMessage({ request: {} }, "x")).toBe(NETWORK_ERROR_MESSAGE);
    expect(apiErrorMessage({ request: {}, code: "ECONNABORTED" }, "x")).toBe(TIMEOUT_MESSAGE);
    expect(apiErrorMessage({ code: "ERR_CANCELED" }, "Cancelled")).toBe("Cancelled");
    expect(apiErrorMessage(new Error("boom"), "Fallback")).toBe("Fallback");
    expect(httpStatus(null)).toBeNull();
  });
});

describe("Retry-After", () => {
  it("parses delta-seconds and HTTP-dates (without native Date)", () => {
    const now = parseApiInstant("2026-10-21T07:27:30Z");
    expect(parseRetryAfter("120", now)).toBe(120);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT", now)).toBe(30);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:00:00 GMT", now)).toBe(0); // in the past
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });

  it("reads the header from plain objects and AxiosHeaders-like objects", () => {
    expect(retryAfterSeconds(response(429, null, { "Retry-After": "5" }))).toBe(5);
    const axiosHeaders = { get: (name: string) => (name.toLowerCase() === "retry-after" ? "7" : undefined) };
    expect(retryAfterSeconds({ response: { status: 429, headers: axiosHeaders } })).toBe(7);
  });
});

describe("readBlobError", () => {
  it("parses a JSON error body that arrived as a Blob (responseType: blob)", async () => {
    const blob = { type: "application/json", text: async () => JSON.stringify({ message: "Range too long." }) };
    const parsed = await readBlobError({ response: { status: 400, data: blob } });
    expect(apiErrorMessage(parsed, "x")).toBe("Range too long.");
  });

  it("keeps plain-text bodies and leaves non-blob errors alone", async () => {
    const text = { text: async () => "Bad range" };
    expect(apiErrorMessage(await readBlobError({ response: { status: 400, data: text } }), "x")).toBe("Bad range");
    const plain = { response: { status: 404, data: { message: "Gone" } } };
    expect(await readBlobError(plain)).toBe(plain);
    const network = { request: {} };
    expect(await readBlobError(network)).toBe(network);
  });

  it("works with a real Blob", async () => {
    const blob = new Blob([JSON.stringify({ message: "Not allowed" })], { type: "application/json" });
    expect(apiErrorMessage(await readBlobError({ response: { status: 404, data: blob } }), "x")).toBe("Not allowed");
  });
});

describe("organizationIdFromUrl", () => {
  it("finds the organization id in API urls", () => {
    const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(organizationIdFromUrl(`/organizations/${id}/tasks/abc`)).toBe(id);
    expect(organizationIdFromUrl(`/organizations/${id}`)).toBe(id);
    expect(organizationIdFromUrl(`/organizations/${id}?x=1`)).toBe(id);
    expect(organizationIdFromUrl("/tasks")).toBeNull();
    expect(organizationIdFromUrl(undefined)).toBeNull();
  });
});
