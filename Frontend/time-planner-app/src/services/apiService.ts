// src/services/apiService.ts — the app's axios instance: access token + X-Time-Zone on every
// request, 401 → one shared token refresh → retry, 403 listeners, and the session guard.
//
// Session guard (docs/plans/auth-session-race.md): every request of the signed-in session is
// stamped with `authStore.sessionEpoch` (bumped on login, logout and session clear). When the
// session changes, its in-flight requests are aborted (requests waiting for a token refresh too)
// and never retried, and a response or retry of an older epoch is rejected with
// SessionChangedError before any caller sees it: a late answer from a cold server can never touch
// the state of another session. Requests marked `sessionIndependent` (token refresh, background
// logout, health ping) carry no access token and are left alone by the guard.

import axios, { CanceledError, isCancel, type AxiosError, type InternalAxiosRequestConfig } from "axios";
import type * as AuthStoreModule from "@/stores/authStore";
import { getActiveTimeZone } from "@/lib/datetime";
import {
  isRefreshRefused,
  isSessionChangedError,
  organizationIdFromUrl,
  SessionChangedError,
} from "@/lib/apiErrors";
import { trackMutation } from "./slowRequests";

declare module "axios" {
  // The type parameter must match axios' own declaration.
  interface AxiosRequestConfig<D = any> {
    /**
     * Not part of the signed-in session: sent without the access token, never aborted or rejected
     * when the session changes, no 401 refresh (token refresh, background logout, health ping).
     */
    sessionIndependent?: boolean;
  }
}

// 1. Create a new axios instance with a custom configuration
const apiService = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

/** Methods that change data: a slow one shows the "Waking up the server…" indicator. */
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Bookkeeping of one request of the signed-in session (lives across the 401 refresh + retry). */
class SessionRequest {
  readonly epoch: number;
  /** Aborted when the session ends (or the caller's own signal aborts). */
  readonly controller = new AbortController();
  private endMutation: (() => void) | null;

  constructor(epoch: number, config: InternalAxiosRequestConfig) {
    this.epoch = epoch;
    const method = (config.method ?? "get").toUpperCase();
    const url = config.url ?? "";
    // Sign-in pages have their own slow hints; only data changes of the session count here.
    this.endMutation = MUTATION_METHODS.has(method) && !url.startsWith("/auth/") ? trackMutation() : null;

    // The caller's own signal (e.g. an export's Cancel) still cancels the request.
    const callerSignal = config.signal;
    if (callerSignal?.aborted) this.controller.abort();
    else callerSignal?.addEventListener?.("abort", () => this.controller.abort(), { once: true });
    config.signal = this.controller.signal;
    liveRequests.add(this);
  }

  /** The request is over (answered, failed for good, or aborted). Idempotent. */
  finish(): void {
    liveRequests.delete(this);
    this.endMutation?.();
    this.endMutation = null;
  }
}

/**
 * A request config with our bookkeeping. `_session` is a class instance, so axios' config merge on
 * the retry copies it by reference (plain objects would be cloned).
 */
type SessionRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean; _session?: SessionRequest };

/** Requests of the session(s) still in flight (including those waiting for a token refresh). */
const liveRequests = new Set<SessionRequest>();

// The router and the auth store are imported lazily. Static imports would close the cycles
// router → views → stores → services → apiService → router and
// apiService → authStore → authService → apiService, which break HMR
// ("Cannot access … before initialization"). Both modules are already loaded by the app, so the
// dynamic import only costs a microtask (and only once: the module is kept for synchronous use).

type AuthStore = ReturnType<typeof AuthStoreModule.useAuthStore>;
let authStoreModule: typeof AuthStoreModule | null = null;

/** The Pinia auth store (tokens, session epoch). */
async function getAuthStore(): Promise<AuthStore> {
  authStoreModule ??= await import("@/stores/authStore");
  return authStoreModule.useAuthStore();
}

/** The auth store without waiting, once a request has loaded it (null before). */
function authStoreNow(): AuthStore | null {
  return authStoreModule?.useAuthStore() ?? null;
}

/** Send the user to the login page (fire and forget, like router.push before). */
function redirectToLogin(query?: Record<string, string>): void {
  import("@/router")
    .then(({ default: router }) => router.push(query ? { path: "/login", query } : "/login"))
    .catch((error: unknown) => console.error("Could not open the login page:", error));
}

/** The request belongs to a session that has ended. */
function isStale(request: SessionRequest | undefined, auth: AuthStore | null): boolean {
  return !!request && !!auth && request.epoch !== auth.sessionEpoch;
}

/**
 * Abort every request of a session other than `epoch` (the auth store calls this whenever the
 * session changes). Their callers get SessionChangedError; nothing of them is retried.
 */
export function abortSessionRequests(epoch: number): void {
  for (const request of [...liveRequests]) {
    if (request.epoch === epoch) continue;
    request.finish();
    request.controller.abort();
  }
}

/** Number of session requests in flight (tests / diagnostics). */
export function liveSessionRequestCount(): number {
  return liveRequests.size;
}

/** Test hook: forget every tracked request and the shared token refresh (nothing is aborted). */
export function resetSessionGuard(): void {
  for (const request of [...liveRequests]) request.finish();
  sharedRefresh = null;
}

/**
 * Wait for `work` unless the request is aborted first: then reject at once with
 * SessionChangedError (session ended) or a CanceledError (the caller cancelled).
 */
function untilAborted<T>(request: SessionRequest | undefined, work: Promise<T>): Promise<T> {
  if (!request) return work;
  const signal = request.controller.signal;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(isStale(request, authStoreNow()) ? new SessionChangedError() : new CanceledError("Request cancelled."));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

// --- 403 Forbidden ---
// A 403 means "signed in, but not allowed" (e.g. a member calling an admin endpoint, or a role
// that just changed). It must never refresh the token or log out. Listeners (the org store, once
// it exists) can re-check the membership of the organization in the URL.

export interface ForbiddenInfo {
  url: string;
  /** Organization id when the URL is `/organizations/{id}/...`. */
  organizationId: string | null;
}

const forbiddenListeners = new Set<(info: ForbiddenInfo) => void>();

/** Be told about every 403 response. Returns the unsubscribe function. */
export function onForbidden(listener: (info: ForbiddenInfo) => void): () => void {
  forbiddenListeners.add(listener);
  return () => forbiddenListeners.delete(listener);
}

function notifyForbidden(url: string): void {
  const info: ForbiddenInfo = { url, organizationId: organizationIdFromUrl(url) };
  for (const listener of forbiddenListeners) {
    try {
      listener(info);
    } catch (error) {
      console.error("403 listener failed:", error);
    }
  }
}

// --- Token refresh ---
// One refresh per session at a time: every 401 of that session (and the background refresh on
// app load / tab return) waits for the same one. The server keeps ONE refresh token per user and
// rotates it, so two parallel refreshes with the same token would log the user out.

let sharedRefresh: { epoch: number; promise: Promise<void> } | null = null;

function refreshSession(auth: AuthStore): Promise<void> {
  const epoch = auth.sessionEpoch;
  if (sharedRefresh && sharedRefresh.epoch === epoch) return sharedRefresh.promise;
  // handleTokenRefresh stores the new tokens only if the session is still the same; if the user
  // logged out meanwhile it discards them, revokes the stray refresh token and throws
  // SessionChangedError.
  const promise = auth.handleTokenRefresh();
  const entry = { epoch, promise };
  sharedRefresh = entry;
  const release = () => {
    if (sharedRefresh === entry) sharedRefresh = null;
  };
  promise.then(release, release);
  return promise;
}

/**
 * Refresh an expired access token now (app load / tab return) instead of on the user's first
 * request; a 401 meanwhile waits for the same refresh. Quiet: a failure leaves the session as it is
 * (the next request handles it as before). Resolves true when new tokens were stored.
 */
export async function refreshSessionInBackground(): Promise<boolean> {
  const auth = await getAuthStore();
  if (!auth.refreshToken) return false;
  try {
    await refreshSession(auth);
    return true;
  } catch (error) {
    if (!isSessionChangedError(error)) console.warn("Background token refresh failed; the next request retries it.", error);
    return false;
  }
}

/** How long the health ping may wait for a cold server. */
export const HEALTH_TIMEOUT_MS = 60_000;

/** GET /api/health (204): starts waking a cold server before the user acts. Never rejects. */
export function wakeServer(): Promise<void> {
  return apiService
    .get("/health", { sessionIndependent: true, timeout: HEALTH_TIMEOUT_MS })
    .then(
      () => undefined,
      () => undefined
    );
}

/** The bearer token a request was sent with, or null. */
function sentToken(config: InternalAxiosRequestConfig): string | null {
  const header = config.headers?.Authorization;
  return typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

// 2. Request interceptor: session stamp, access token, the user's time zone
apiService.interceptors.request.use(
  async (config) => {
    // IANA zone of the device (e.g. "Europe/Oslo"). The server buckets analytics and task years
    // by this zone's calendar; without it the server falls back to UTC.
    config.headers["X-Time-Zone"] = getActiveTimeZone();
    if (config.sessionIndependent) return config;

    const req = config as SessionRequestConfig;
    const authStore = authStoreNow() ?? (await getAuthStore());
    if (!req._session) {
      req._session = new SessionRequest(authStore.sessionEpoch, req);
    } else if (isStale(req._session, authStore)) {
      // A retry (after a token refresh) for a session that has ended: never send it.
      req._session.finish();
      throw new SessionChangedError();
    }

    const token = authStore.accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: unknown) => {
    return Promise.reject(error);
  }
);

// 3. Response interceptor: the session guard, 403 listeners, 401 refresh + retry
apiService.interceptors.response.use(
  (response) => {
    const request = (response.config as SessionRequestConfig)._session;
    if (!request) return response;
    request.finish();
    // The answer arrived after the session ended (e.g. a cold server answering a logged-out user).
    if (isStale(request, authStoreNow())) return Promise.reject(new SessionChangedError());
    return response;
  },
  async (error: AxiosError | SessionChangedError) => {
    // A stale retry refused by the request interceptor.
    if (isSessionChangedError(error)) return Promise.reject(error);

    const originalRequest = error.config as SessionRequestConfig | undefined;
    if (!originalRequest || originalRequest.sessionIndependent) return Promise.reject(error);
    const request = originalRequest._session;
    const authStore = authStoreNow() ?? (await getAuthStore());

    // Aborted at logout, or answered after the session ended: nobody may see it.
    if (isStale(request, authStore)) {
      request?.finish();
      return Promise.reject(new SessionChangedError());
    }

    const url = originalRequest.url ?? "";

    // --- CRITICAL LOOP BREAKER ---
    // If the error comes from the refresh endpoint or logout endpoint, DO NOT retry.
    // This stops the infinite loop/stack overflow.
    if (url.includes("/auth/refresh") || url.includes("/auth/logout")) {
      request?.finish();
      return Promise.reject(error);
    }

    // 403: signed in but not allowed — never refresh, never log out.
    if (error.response?.status === 403) {
      request?.finish();
      notifyForbidden(url);
      return Promise.reject(error);
    }

    // Check for 401 Unauthorized
    if (error.response?.status === 401 && !originalRequest._retry) {
      // If we don't have a refresh token, we can't do anything. Logout.
      if (!authStore.refreshToken) {
        request?.finish();
        await authStore.logout();
        redirectToLogin();
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      // Another request may have refreshed the token while this one was on its way: just retry.
      const sent = sentToken(originalRequest);
      const refreshedMeanwhile = sent !== null && !!authStore.accessToken && sent !== authStore.accessToken;
      if (!refreshedMeanwhile) {
        try {
          // Shared by every 401 of this session; a logout rejects the wait at once.
          await untilAborted(request, refreshSession(authStore));
        } catch (refreshError) {
          request?.finish();
          if (isSessionChangedError(refreshError) || isStale(request, authStore)) {
            return Promise.reject(new SessionChangedError());
          }
          if (isCancel(refreshError)) return Promise.reject(refreshError);

          // A cold or unreachable server (no answer, timeout, 408, 429, 5xx) says nothing about
          // the session: keep the tokens and fail this request with that error (network / server
          // copy). The next request tries the refresh again.
          if (!isRefreshRefused(refreshError)) return Promise.reject(refreshError);

          // The server refused the refresh token (expired / revoked): the session is over. Log
          // out locally (the dropped token is still revoked in the background, best effort) and
          // ask the user to sign in again. Requests waiting for this refresh are aborted by the
          // session change.
          await authStore.logout();
          redirectToLogin({ sessionExpired: "true" });
          return Promise.reject(new Error("Session expired. Please log in again."));
        }
      }

      // Retry with the new token (the request interceptor attaches it and re-checks the session).
      return apiService(originalRequest);
    }

    // Return any other error as is
    request?.finish();
    return Promise.reject(error);
  }
);

export default apiService;
