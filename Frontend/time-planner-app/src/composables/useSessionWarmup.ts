// src/composables/useSessionWarmup.ts — get a cold server and an expired token ready BEFORE the
// signed-in user acts (docs/plans/auth-session-race.md, cold-start UX).
//
// The hosted API is unloaded after a while without traffic, and the access token expires much
// sooner than the session. So, with a stored session:
//   - on app load, and when the tab comes back after LONG_AWAY_MS hidden/blurred: ping
//     GET /api/health (fire and forget) to start waking the server;
//   - on app load and on every return: if the access token has expired (or is about to), refresh
//     it in the background (apiService shares that refresh with any 401 meanwhile).
// Guests have nothing to wake. Failures are quiet: the next request handles them as before.

import { refreshSessionInBackground, wakeServer } from "@/services/apiService";
import { useAuthStore } from "@/stores/authStore";
import { isJwtExpired } from "@/lib/jwt";
import { now } from "@/lib/datetime";

/** Away (tab hidden or window blurred) at least this long counts as "long idle": ping the server. */
export const LONG_AWAY_MS = 5 * 60_000;
/** Refresh a token that expires within this margin (it would expire on the way to a cold server). */
export const EXPIRY_MARGIN_MS = 60_000;

/** Minimal event target (document / window, or fakes in tests). */
interface Listenable {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

export interface SessionWarmupDeps {
  ping: () => void;
  refresh: () => void;
  now: () => number;
  /** "visible" | "hidden" (document.visibilityState). */
  visibility: () => string;
  document: Listenable;
  window: Listenable;
}

function defaultDeps(): SessionWarmupDeps {
  return {
    ping: () => void wakeServer(),
    refresh: () => void refreshSessionInBackground(),
    now: () => now(),
    visibility: () => document.visibilityState,
    document,
    window,
  };
}

/**
 * Start warming up (call once, e.g. from App.vue's onMounted). Runs the app-load check right away.
 * Returns the function that removes the listeners.
 */
export function installSessionWarmup(overrides: Partial<SessionWarmupDeps> = {}): () => void {
  const deps: SessionWarmupDeps = { ...defaultDeps(), ...overrides };
  let awaySince: number | null = null;

  function warmUp(ping: boolean): void {
    const auth = useAuthStore();
    if (!auth.isAuthenticated || !auth.refreshToken) return; // guests: nothing to wake
    if (ping) deps.ping();
    if (isJwtExpired(auth.accessToken, deps.now() + EXPIRY_MARGIN_MS)) deps.refresh();
  }

  const leave = () => {
    awaySince ??= deps.now();
  };
  const back = () => {
    if (awaySince === null) return;
    const away = deps.now() - awaySince;
    awaySince = null;
    warmUp(away >= LONG_AWAY_MS);
  };
  const onVisibilityChange = () => (deps.visibility() === "hidden" ? leave() : back());

  warmUp(true);
  deps.document.addEventListener("visibilitychange", onVisibilityChange);
  deps.window.addEventListener("blur", leave);
  deps.window.addEventListener("focus", back);

  return () => {
    deps.document.removeEventListener("visibilitychange", onVisibilityChange);
    deps.window.removeEventListener("blur", leave);
    deps.window.removeEventListener("focus", back);
  };
}
