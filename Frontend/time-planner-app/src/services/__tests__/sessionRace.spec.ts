/**
 * The cold-start logout race (docs/plans/auth-session-race.md) at the API layer: the real auth
 * store, auth service and apiService against an in-memory fake API (fakeApi.ts). Covers the
 * refresh guard, stale responses, instant logout, epochs across logins, aborts, the slow-mutation
 * indicator, the health ping and the background refresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  CATEGORY,
  FakeApi,
  expiredAccessToken,
  flushMicrotasks,
  installBrowserGlobals,
  validAccessToken,
} from "./fakeApi";

const routerPush = vi.fn();
vi.mock("@/router", () => ({ default: { push: routerPush } }));

import apiService, {
  liveSessionRequestCount,
  refreshSessionInBackground,
  resetSessionGuard,
  wakeServer,
} from "../apiService";
import { isMutationSlow, resetSlowMutations, SLOW_MUTATION_MS } from "../slowRequests";
import { useAuthStore } from "@/stores/authStore";
import { SessionChangedError, isSessionChangedError } from "@/lib/apiErrors";

const storage = installBrowserGlobals();
const originalAdapter = apiService.defaults.adapter;
let api: FakeApi;

/** Start the app with a stored session (as after a page load). */
function signedIn(accessToken: string, refreshToken = "refresh-0") {
  storage.set("accessToken", accessToken);
  storage.set("refreshToken", refreshToken);
  setActivePinia(createPinia());
  return useAuthStore();
}

/** A stored session the fake server knows (its refresh token is the server's current one). */
function serverSession(options: { expired?: boolean } = {}) {
  const tokens = api.issueTokens();
  return signedIn(options.expired ? expiredAccessToken() : tokens.accessToken, tokens.refreshToken);
}

const until = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));
const lastCall = (method: string, url: string) => {
  const calls = api.find(method, url);
  return calls[calls.length - 1]!;
};
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  storage.clear();
  api = new FakeApi();
  apiService.defaults.adapter = api.adapter;
  routerPush.mockReset();
  resetSessionGuard();
  resetSlowMutations();
});

afterEach(async () => {
  vi.useRealTimers();
  api.wake(); // let nothing hang into the next test
  await flush();
  apiService.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});

/** Silence the expected console noise of failing refreshes / revokes. */
function quietConsole(): void {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("refresh guard", () => {
  it("a refresh that resolves after logout restores nothing, revokes the stray token and rejects the waiting requests", async () => {
    const auth = serverSession({ expired: true });
    const oldRefresh = auth.refreshToken!;
    // Both requests get 401 (expired token); the shared refresh — and later the background
    // logout — wait for a cold server.
    api.hold = (call) => call.url.startsWith("/auth/");

    const firstSettled = apiService.get("/tasks").catch((e: unknown) => e);
    const secondSettled = apiService.post("/tasks", { title: "x" }).catch((e: unknown) => e);
    await until(() => api.find("POST", "/auth/refresh").length === 1);
    await flushMicrotasks();
    expect(api.find("POST", "/auth/refresh")).toHaveLength(1); // one refresh for both 401s

    await auth.logout();

    // Rejected at once, while the server is still cold.
    expect(await firstSettled).toBeInstanceOf(SessionChangedError);
    expect(await secondSettled).toBeInstanceOf(SessionChangedError);
    await until(() => api.heldCount === 2); // the refresh + the background logout, both still waiting

    api.wake();
    await until(() => api.find("POST", "/auth/logout").length === 2);
    await flush();

    // Tokens never restored.
    expect(auth.accessToken).toBeNull();
    expect(auth.refreshToken).toBeNull();
    expect(auth.status).toBe("guest");
    expect(storage.has("accessToken")).toBe(false);
    expect(storage.has("refreshToken")).toBe(false);

    // Logout revoked the old token, then the guard revoked the rotated one — both anonymously.
    const revokes = api.find("POST", "/auth/logout");
    expect(revokes.map((c) => (c.body as { refreshToken: string }).refreshToken)).toEqual([oldRefresh, "refresh-2"]);
    expect(revokes.every((c) => c.authorization === null)).toBe(true);
    expect(api.storedRefreshToken).toBeNull(); // the session is dead server-side

    // Nothing retried, no "session expired" redirect.
    expect(api.find("GET", "/tasks")).toHaveLength(1);
    expect(api.find("POST", "/tasks")).toHaveLength(1);
    expect(routerPush).not.toHaveBeenCalled();
    expect(liveSessionRequestCount()).toBe(0);
  });

  it("an old session's refresh failing during a new session does not log the new one out", async () => {
    quietConsole();
    const auth = serverSession({ expired: true });
    api.hold = (call) => call.url === "/auth/refresh";
    const request = apiService.get("/tasks").catch((e: unknown) => e);
    await until(() => api.find("POST", "/auth/refresh").length === 1);

    await auth.logout();
    expect(await request).toBeInstanceOf(SessionChangedError);

    // Signed in again before the old refresh is answered (the login rotates the server's token,
    // so the old refresh will be refused).
    expect(await auth.login({ email: "a@b.c", password: "pw" })).toBe(true);
    const newAccess = auth.accessToken;
    const newRefresh = auth.refreshToken;

    api.wake(); // the old refresh now fails with 401
    await flush();

    expect(auth.accessToken).toBe(newAccess);
    expect(auth.refreshToken).toBe(newRefresh);
    expect(auth.status).toBe("loggedIn");
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("a refresh refused while the session is unchanged still logs out and asks to sign in again (unchanged)", async () => {
    quietConsole();
    const auth = signedIn(expiredAccessToken(), "unknown-refresh-token");
    const error = await apiService.get("/tasks").catch((e: unknown) => e);

    expect(isSessionChangedError(error)).toBe(false);
    expect((error as Error).message).toMatch(/Session expired/);
    expect(auth.accessToken).toBeNull();
    expect(auth.status).toBe("guest");
    await until(() => routerPush.mock.calls.length === 1);
    expect(routerPush).toHaveBeenCalledWith({ path: "/login", query: { sessionExpired: "true" } });
  });
});

describe("stale responses", () => {
  it("an answer that arrives after logout is rejected with SessionChangedError (server ignores the abort)", async () => {
    const auth = serverSession();
    api.cold = true;
    api.honourAbort = false;
    const settled = apiService.get("/tasks").catch((e: unknown) => e);
    const failed = apiService.get("/categories").catch((e: unknown) => e);
    await until(() => api.heldCount === 2);

    await auth.logout();
    api.routes.push((call) => (call.url === "/categories" ? { status: 500 } : undefined));
    api.wake();

    expect(await settled).toBeInstanceOf(SessionChangedError);
    expect(await failed).toBeInstanceOf(SessionChangedError); // errors too: no toast-worthy 500
  });

  it("aborts the session's in-flight requests on logout and never retries them", async () => {
    const auth = serverSession();
    api.cold = true;
    const pending = [apiService.get("/tasks"), apiService.post("/tasks", { title: "x" }), apiService.delete("/tasks/1")].map(
      (p) => p.catch((e: unknown) => e)
    );
    await until(() => api.heldCount === 3);
    expect(liveSessionRequestCount()).toBe(3);

    await auth.logout();

    for (const result of await Promise.all(pending)) expect(result).toBeInstanceOf(SessionChangedError);
    const sessionCalls = api.calls.filter((c) => !c.url.startsWith("/auth/"));
    expect(sessionCalls.every((c) => c.aborted)).toBe(true);
    expect(liveSessionRequestCount()).toBe(0);
    api.wake();
    await flush();
    expect(api.calls.filter((c) => !c.url.startsWith("/auth/"))).toHaveLength(3); // no retries
  });

  it("the caller's own cancel still works (CanceledError, session untouched)", async () => {
    const auth = serverSession();
    api.cold = true;
    const controller = new AbortController();
    const result = apiService.get("/tasks", { signal: controller.signal }).catch((e: unknown) => e);
    await until(() => api.heldCount === 1);
    controller.abort();

    const error = await result;
    expect(isSessionChangedError(error)).toBe(false);
    expect(error).toMatchObject({ code: "ERR_CANCELED" });
    expect(auth.status).toBe("loggedIn");
  });
});

describe("instant logout", () => {
  it("switches to guest at once while the server is unreachable, and revokes in the background", async () => {
    const auth = serverSession();
    const refreshToken = auth.refreshToken;
    api.cold = true; // never answers during this test
    const inFlight = apiService.post("/tasks", { title: "x" }).catch((e: unknown) => e);
    await until(() => api.heldCount === 1);
    const epoch = auth.sessionEpoch;

    await auth.logout(); // resolves without any answer from the server

    expect(auth.status).toBe("guest");
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.sessionEpoch).toBe(epoch + 1);
    expect(storage.has("refreshToken")).toBe(false);
    expect(await inFlight).toBeInstanceOf(SessionChangedError);

    await until(() => api.find("POST", "/auth/logout").length === 1);
    const revoke = api.find("POST", "/auth/logout")[0]!;
    expect(revoke.body).toEqual({ refreshToken });
    expect(revoke.authorization).toBeNull(); // never the access token (it could revoke a newer session)
    expect(revoke.processed).toBe(false); // still waiting: logout did not wait for it
  });

  it("a background logout that fails is ignored (no unhandled rejection, still guest)", async () => {
    const auth = serverSession();
    api.routes.push((call) => (call.url === "/auth/logout" ? { status: 500 } : undefined));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await auth.logout();
    await until(() => warn.mock.calls.length > 0);
    expect(auth.status).toBe("guest");
  });
});

describe("session epochs", () => {
  it("login → logout → login: each session has its own epoch and old answers never leak into the new one", async () => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    expect(auth.sessionEpoch).toBe(0);

    expect(await auth.login({ email: "a@b.c", password: "pw" })).toBe(true);
    expect(auth.sessionEpoch).toBe(1);

    api.cold = true;
    api.honourAbort = false;
    const fromFirstSession = apiService.get("/categories").catch((e: unknown) => e);
    await until(() => api.heldCount === 1);

    await auth.logout();
    expect(auth.sessionEpoch).toBe(2);

    api.cold = false;
    expect(await auth.login({ email: "a@b.c", password: "pw" })).toBe(true);
    expect(auth.sessionEpoch).toBe(3);

    api.wake(); // the first session's answer arrives during the third epoch
    expect(await fromFirstSession).toBeInstanceOf(SessionChangedError);

    const fresh = await apiService.get<unknown[]>("/categories");
    expect(fresh.data).toEqual([CATEGORY]);
  });

  it("a token refresh keeps the epoch; clearing a guest (no session) does not bump it", async () => {
    const auth = serverSession({ expired: true });
    await apiService.get("/tasks");
    expect(auth.sessionEpoch).toBe(0);

    storage.clear();
    setActivePinia(createPinia());
    const guest = useAuthStore();
    expect(guest.status).toBe("guest");
    guest._clearTokens(); // e.g. a guest's 401 on a wrong password
    expect(guest.sessionEpoch).toBe(0);
  });
});

describe("token refresh sharing", () => {
  it("concurrent 401s share one refresh and retry with the new token", async () => {
    serverSession({ expired: true });
    const results = await Promise.all([apiService.get("/tasks"), apiService.get("/categories"), apiService.get("/tasktemplates")]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(api.find("POST", "/auth/refresh")).toHaveLength(1);
  });

  it("a 401 for a token that was already refreshed meanwhile retries without refreshing again", async () => {
    const auth = serverSession({ expired: true });
    api.cold = true;
    const slow = apiService.get("/tasks");
    await until(() => api.heldCount === 1);
    api.cold = false;
    await apiService.get("/categories"); // refreshes
    expect(api.find("POST", "/auth/refresh")).toHaveLength(1);
    const refreshed = auth.accessToken;

    api.wake(); // the slow request's 401 arrives now
    expect((await slow).status).toBe(200);
    expect(api.find("POST", "/auth/refresh")).toHaveLength(1);
    expect(lastCall("GET", "/tasks").authorization).toBe(`Bearer ${refreshed}`);
  });
});

describe("slow mutation indicator", () => {
  it("shows after 3 s for a pending create/update/delete and hides when it settles", async () => {
    vi.useFakeTimers();
    serverSession();
    api.cold = true;
    const create = apiService.post("/tasks", { title: "x", start: "2026-10-05T07:00:00.000Z", duration: 1, categoryId: "c" });
    await flushMicrotasks();
    expect(api.heldCount).toBe(1);

    await vi.advanceTimersByTimeAsync(SLOW_MUTATION_MS - 1);
    expect(isMutationSlow.value).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(isMutationSlow.value).toBe(true);

    api.wake();
    await create;
    expect(isMutationSlow.value).toBe(false);
  });

  it("ignores reads, sign-in calls and background calls", async () => {
    vi.useFakeTimers();
    serverSession();
    api.cold = true;
    void apiService.get("/tasks").catch(() => {});
    void apiService.post("/auth/login", {}).catch(() => {});
    void wakeServer();
    await flushMicrotasks();
    expect(api.heldCount).toBe(3);
    await vi.advanceTimersByTimeAsync(SLOW_MUTATION_MS * 2);
    expect(isMutationSlow.value).toBe(false);
  });

  it("stays on through a token refresh + retry, and goes away at once on logout", async () => {
    vi.useFakeTimers();
    const auth = serverSession({ expired: true });
    api.cold = true;
    const save = apiService.put("/tasks/1", { title: "x" }).catch((e: unknown) => e);
    await flushMicrotasks();
    expect(api.heldCount).toBe(1);
    await vi.advanceTimersByTimeAsync(SLOW_MUTATION_MS);
    expect(isMutationSlow.value).toBe(true);

    api.wake(); // 401 → refresh (cold again) → still the same mutation
    api.cold = true;
    await flushMicrotasks();
    expect(api.find("POST", "/auth/refresh")).toHaveLength(1);
    expect(isMutationSlow.value).toBe(true);

    await auth.logout();
    expect(isMutationSlow.value).toBe(false);
    expect(await save).toBeInstanceOf(SessionChangedError);
  });
});

describe("cold-start warm-up calls", () => {
  it("wakeServer pings GET /health anonymously and never rejects", async () => {
    serverSession();
    await wakeServer();
    const ping = api.find("GET", "/health")[0]!;
    expect(ping.authorization).toBeNull();
    expect(liveSessionRequestCount()).toBe(0);

    api.routes.push(() => ({ status: 503 }));
    await expect(wakeServer()).resolves.toBeUndefined();
  });

  it("the background refresh stores new tokens, and a 401 meanwhile joins it", async () => {
    const auth = serverSession({ expired: true });
    api.hold = (call) => call.url === "/auth/refresh";
    const background = refreshSessionInBackground();
    await until(() => api.find("POST", "/auth/refresh").length === 1);
    const request = apiService.get("/tasks"); // 401 with the expired token → waits for the same refresh
    await until(() => api.find("GET", "/tasks").length === 1);

    api.wake();
    expect(await background).toBe(true);
    expect((await request).status).toBe(200);
    expect(api.find("POST", "/auth/refresh")).toHaveLength(1);
    expect(`Bearer ${auth.accessToken}`).toBe(lastCall("GET", "/tasks").authorization);
  });

  it("a failed background refresh is quiet: the session stays, no redirect", async () => {
    quietConsole();
    const auth = signedIn(expiredAccessToken(), "refresh-0");
    api.routes.push((call) => (call.url === "/auth/refresh" ? { status: 503 } : undefined));

    expect(await refreshSessionInBackground()).toBe(false);
    expect(auth.refreshToken).toBe("refresh-0");
    expect(auth.status).toBe("loggedIn");
    await flush();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("a background refresh answered after logout is discarded and revoked", async () => {
    const auth = serverSession({ expired: true });
    api.cold = true;
    const background = refreshSessionInBackground();
    await until(() => api.find("POST", "/auth/refresh").length === 1);
    await auth.logout();
    await until(() => api.heldCount === 2);
    api.wake();

    expect(await background).toBe(false);
    await until(() => api.find("POST", "/auth/logout").length === 2);
    expect(auth.accessToken).toBeNull();
    expect(api.storedRefreshToken).toBeNull();
  });
});

describe("valid tokens", () => {
  it("are sent as before (no refresh)", async () => {
    signedIn(validAccessToken());
    api.validAccessTokens.add(storage.get("accessToken")!);
    await apiService.get("/tasks");
    expect(api.find("POST", "/auth/refresh")).toHaveLength(0);
  });
});
