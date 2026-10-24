// src/lib/authRedirect.ts — where to go after signing in.
//
// - `safeRedirect()` accepts only same-site paths from `?redirect=` (open-redirect guard).
// - An invitation link opened while signed out is remembered in localStorage
//   (`tp-pending-invitation` = { token, savedAt }) for 7 days, so the flow survives creating an
//   account and confirming the email (which loses the `redirect` query): the next sign-in without
//   an explicit redirect lands on `/invitations/:token`.

import { nowInstant, now, tryParseApiInstant } from "@/lib/datetime";
import type { LocationQueryValue } from "vue-router";

/**
 * The redirect target if it is a path on this site, else null. Accepts "/orgs/x/board?y=1#z";
 * rejects absolute URLs, protocol-relative "//evil.com", "/\evil.com" (browsers treat "\" as "/"),
 * any backslash and control characters (which browsers strip, turning "/\t/evil.com" into "//…").
 */
export function safeRedirect(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  if (raw[0] !== "/") return null;
  if (raw.startsWith("//")) return null;
  if (/[\\\u0000-\u001F\u007F]/.test(raw)) return null;
  return raw;
}

/** Why the login page was opened (`?reason=`). */
export type LoginReason = "orgs";

/** `/login?redirect=<path>&reason=orgs` for a guest who opened a signed-in-only page. */
export function loginLocation(redirect: string, reason?: LoginReason): { path: string; query: Record<string, string> } {
  const query: Record<string, string> = {};
  const safe = safeRedirect(redirect);
  if (safe && safe !== "/") query.redirect = safe;
  if (reason) query.reason = reason;
  return { path: "/login", query };
}

// ---------------------------------------------------------------------------------------------
// Pending invitation
// ---------------------------------------------------------------------------------------------

export const PENDING_INVITATION_KEY = "tp-pending-invitation";
export const PENDING_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Path of the invitation landing page for a token. */
export function invitationPath(token: string): string {
  return `/invitations/${encodeURIComponent(token)}`;
}

/** Remember an invitation token opened while signed out. */
export function savePendingInvitation(token: string, storage: StorageLike | null = defaultStorage()): void {
  if (!token) return;
  try {
    storage?.setItem(PENDING_INVITATION_KEY, JSON.stringify({ token, savedAt: nowInstant() }));
  } catch {
    /* storage unavailable or full: the redirect query still covers the direct login path */
  }
}

export function clearPendingInvitation(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(PENDING_INVITATION_KEY);
  } catch {
    /* ignore */
  }
}

/** The remembered token if it was saved within the last 7 days (an older or broken entry is removed). */
export function readPendingInvitation(storage: StorageLike | null = defaultStorage(), nowMs: number = now()): string | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(PENDING_INVITATION_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; savedAt?: unknown };
    const savedAt = tryParseApiInstant(parsed.savedAt);
    const token = typeof parsed.token === "string" ? parsed.token : "";
    if (token && savedAt !== null && nowMs - savedAt >= 0 && nowMs - savedAt < PENDING_INVITATION_TTL_MS) return token;
  } catch {
    /* fall through: broken entry */
  }
  clearPendingInvitation(storage);
  return null;
}

/**
 * Where a successful sign-in goes: the safe `?redirect=`, else a pending invitation, else the
 * planner.
 */
export function postLoginPath(
  redirect: LocationQueryValue | LocationQueryValue[] | undefined,
  storage: StorageLike | null = defaultStorage(),
  nowMs: number = now()
): string {
  const safe = safeRedirect(redirect);
  if (safe) return safe;
  const token = readPendingInvitation(storage, nowMs);
  return token ? invitationPath(token) : "/";
}
