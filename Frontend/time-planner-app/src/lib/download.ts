// src/lib/download.ts — saving files the app produced or fetched (report exports, guest CSV).
//
// saveBlob() uses an object URL and a temporary <a download>, never window.open(): opening a
// window after an `await` is blocked as a popup on iOS Safari (no user gesture any more).

import type { AnalyticsView } from "@/lib/analyticsBuckets";
import type { DateKey } from "@/lib/datetime";

/** How long the object URL stays alive after the click (slow devices may start the save late). */
export const OBJECT_URL_TTL_MS = 30_000;

/** Characters that are not allowed (or risky) in file names on common systems. */
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

/** Strip path parts and characters that file systems reject; null when nothing usable is left. */
export function sanitizeFileName(name: string): string | null {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(UNSAFE_FILENAME_CHARS, "_").trim().replace(/^\.+/, "");
  return cleaned ? cleaned.slice(0, 200) : null;
}

/** Decode an RFC 5987 `ext-value` (`UTF-8''time%20planner.pdf`); null when malformed. */
function decodeExtValue(value: string): string | null {
  const m = /^([A-Za-z0-9!#$%&+^_`{}~-]+)'[^']*'(.*)$/.exec(value.trim());
  if (!m) return null;
  const charset = m[1]!.toLowerCase();
  const encoded = m[2]!;
  try {
    if (charset === "utf-8") return decodeURIComponent(encoded);
    if (charset === "iso-8859-1") {
      return encoded.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
      );
    }
  } catch {
    return null;
  }
  return null;
}

/** Split header parameters on `;`, respecting quoted strings. */
function splitParams(header: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i]!;
    if (quoted && ch === "\\" && i + 1 < header.length) {
      current += ch + header[++i];
      continue;
    }
    if (ch === '"') quoted = !quoted;
    if (ch === ";" && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return v;
}

/**
 * File name from a `Content-Disposition` header. Prefers `filename*` (RFC 5987/6266, UTF-8) over
 * `filename`; returns a sanitized name, or null when the header is missing or has no name.
 */
export function parseContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  let plain: string | null = null;
  let extended: string | null = null;
  for (const param of splitParams(header)) {
    const eq = param.indexOf("=");
    if (eq === -1) continue;
    const key = param.slice(0, eq).trim().toLowerCase();
    const value = param.slice(eq + 1);
    if (key === "filename*") extended = decodeExtValue(unquote(value));
    else if (key === "filename") plain = unquote(value);
  }
  for (const candidate of [extended, plain]) {
    const safe = candidate ? sanitizeFileName(candidate) : null;
    if (safe) return safe;
  }
  return null;
}

/** `time-planner-analytics-weekly-2026-10-11.pdf` — used when the server sends no file name. */
export function fallbackExportFileName(view: AnalyticsView, extension: string, today: DateKey): string {
  return `time-planner-analytics-${view}-${today}.${extension}`;
}

/** The DOM pieces saveBlob() needs (injectable for tests). */
export interface SaveBlobEnv {
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  document: Pick<Document, "createElement" | "body">;
  setTimeout: (handler: () => void, ms: number) => unknown;
}

function browserEnv(): SaveBlobEnv {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    document,
    setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  };
}

/**
 * Save a Blob as a file: object URL + a temporary `<a download>` clicked programmatically, removed
 * right away; the URL is revoked after {@link OBJECT_URL_TTL_MS}.
 */
export function saveBlob(blob: Blob, filename: string, env: SaveBlobEnv = browserEnv()): void {
  const url = env.createObjectURL(blob);
  const link = env.document.createElement("a");
  link.href = url;
  link.download = sanitizeFileName(filename) ?? "download";
  link.rel = "noopener";
  link.style.display = "none";
  env.document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    env.setTimeout(() => env.revokeObjectURL(url), OBJECT_URL_TTL_MS);
  }
}
