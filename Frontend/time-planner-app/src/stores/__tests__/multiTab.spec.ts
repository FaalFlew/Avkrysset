/**
 * Tabs share the tokens in localStorage. Two auth stores (two "tabs") over one fake localStorage,
 * with `storage` events dispatched by hand (browsers only send them to the OTHER tabs):
 * a logout in one tab ends the session in the others, a refresh in one tab is adopted by the
 * others (same session, no fight over the one refresh token the server keeps), and a refresh
 * answered after another tab logged out is discarded and revoked instead of signing the user
 * back in. The network is mocked (authService.refresh / revokeRefreshToken).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { FakeLocks, flushMicrotasks, installBrowserGlobals, makeJwt } from "@/services/__tests__/fakeApi";
import { SessionChangedError } from "@/lib/apiErrors";
import { TOKEN_REFRESH_LOCK } from "@/lib/crossTabLock";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  revokeRefreshToken: vi.fn(),
  abortSessionRequests: vi.fn(),
}));
vi.mock("@/services/authService", () => ({
  authService: { refresh: mocks.refresh, revokeRefreshToken: mocks.revokeRefreshToken },
}));
vi.mock("@/services/apiService", () => ({ abortSessionRequests: mocks.abortSessionRequests }));

import { syncSessionAcrossTabs, useAuthStore } from "../authStore";

const storage = installBrowserGlobals();
const access = (sub: string, n: number) => makeJwt({ sub, jti: String(n) });

/** A browser tab: its own Pinia + auth store, listening to its own `storage` events. */
function openTab() {
  setActivePinia(createPinia());
  const auth = useAuthStore();
  const target = new EventTarget();
  syncSessionAcrossTabs(auth, target);
  return {
    auth,
    /** The browser tells this tab that another tab changed `key` (null = localStorage.clear()). */
    storageEvent(key: string | null) {
      target.dispatchEvent(Object.assign(new Event("storage"), { key }));
    },
  };
}

/** Both tabs signed in to the same session (as after a reload of each). */
function twoSignedInTabs() {
  storage.set("accessToken", access("user-1", 1));
  storage.set("refreshToken", "rt-1");
  return { one: openTab(), two: openTab() };
}

let locks: FakeLocks;

beforeEach(() => {
  storage.clear();
  vi.resetAllMocks(); // also drops queued mockImplementationOnce answers
  vi.spyOn(console, "error").mockImplementation(() => {});
  locks = new FakeLocks();
  vi.stubGlobal("navigator", { locks });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A fake server keeping ONE refresh token and rotating it on every refresh; each answer takes a
 * few microtasks (so two tabs really overlap). A refused refresh rejects like axios (401).
 */
function rotatingServer(options: { samePairForConcurrent?: boolean } = {}) {
  const server = { stored: "rt-1", n: 1, calls: 0, inFlight: new Map<string, { accessToken: string; refreshToken: string }>() };
  mocks.refresh.mockImplementation(async (refreshToken: string) => {
    server.calls += 1;
    // With the backend's race-safe refresh, concurrent refreshes of one token get the same pair.
    const shared = options.samePairForConcurrent ? server.inFlight.get(refreshToken) : undefined;
    if (shared) {
      await flushMicrotasks(5);
      return shared;
    }
    if (refreshToken !== server.stored) {
      await flushMicrotasks(5);
      throw { response: { status: 401 } };
    }
    server.n += 1;
    server.stored = `rt-${server.n}`;
    const pair = { accessToken: access("user-1", server.n), refreshToken: server.stored };
    server.inFlight.set(refreshToken, pair);
    await flushMicrotasks(5);
    return pair;
  });
  return server;
}

describe("storage events", () => {
  it("a logout in another tab ends this tab's session (new epoch, requests aborted, guest)", async () => {
    const { one, two } = twoSignedInTabs();
    await one.auth.logout();
    two.storageEvent("accessToken");
    two.storageEvent("refreshToken");

    expect(two.auth.status).toBe("guest");
    expect(two.auth.isAuthenticated).toBe(false);
    expect(two.auth.sessionEpoch).toBe(1);
    expect(mocks.abortSessionRequests).toHaveBeenLastCalledWith(1);
    expect(mocks.revokeRefreshToken).toHaveBeenCalledTimes(1); // only the tab that logged out revokes
  });

  it("localStorage.clear() in another tab (key null) ends the session too", () => {
    const { two } = twoSignedInTabs();
    storage.clear();
    two.storageEvent(null);
    expect(two.auth.status).toBe("guest");
  });

  it("a refresh in another tab is adopted: same session, same epoch", async () => {
    const { one, two } = twoSignedInTabs();
    mocks.refresh.mockResolvedValueOnce({ accessToken: access("user-1", 2), refreshToken: "rt-2" });
    await one.auth.handleTokenRefresh();
    two.storageEvent("accessToken");
    two.storageEvent("refreshToken");

    expect(two.auth.accessToken).toBe(access("user-1", 2));
    expect(two.auth.refreshToken).toBe("rt-2");
    expect(two.auth.sessionEpoch).toBe(0);
    expect(mocks.abortSessionRequests).not.toHaveBeenCalled();
  });

  it("a half-written pair (only the access token so far) is ignored until the refresh token follows", () => {
    const { two } = twoSignedInTabs();
    storage.set("accessToken", access("user-1", 2));
    two.storageEvent("accessToken");
    expect(two.auth.refreshToken).toBe("rt-1");
    expect(two.auth.accessToken).toBe(access("user-1", 1));

    storage.set("refreshToken", "rt-2");
    two.storageEvent("refreshToken");
    expect(two.auth.accessToken).toBe(access("user-1", 2));
    expect(two.auth.refreshToken).toBe("rt-2");
  });

  it("another user's tokens, or a login while this tab is a guest, start a new session here", () => {
    const { two } = twoSignedInTabs();
    storage.set("accessToken", access("user-2", 1));
    storage.set("refreshToken", "rt-other");
    two.storageEvent("refreshToken");
    expect(two.auth.refreshToken).toBe("rt-other");
    expect(two.auth.sessionEpoch).toBe(1);

    storage.clear();
    setActivePinia(createPinia());
    const guestTab = openTab();
    storage.set("accessToken", access("user-1", 5));
    storage.set("refreshToken", "rt-5");
    guestTab.storageEvent("refreshToken");
    expect(guestTab.auth.status).toBe("loggedIn");
    expect(guestTab.auth.sessionEpoch).toBe(1);
  });

  it("unrelated keys are ignored", () => {
    const { two } = twoSignedInTabs();
    storage.clear();
    two.storageEvent("tp-sidebar");
    expect(two.auth.status).toBe("loggedIn");
  });
});

describe("refresh results checked against the other tabs", () => {
  it("another tab logged out while this tab's refresh was on a cold server: tokens discarded + revoked", async () => {
    const { one, two } = twoSignedInTabs();
    let answer!: (tokens: { accessToken: string; refreshToken: string }) => void;
    mocks.refresh.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const refreshing = two.auth.handleTokenRefresh();
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1)); // on the server now

    await one.auth.logout(); // the storage event has not reached tab two yet
    answer({ accessToken: access("user-1", 2), refreshToken: "rt-2" });

    await expect(refreshing).rejects.toBeInstanceOf(SessionChangedError);
    expect(two.auth.status).toBe("guest");
    expect(storage.has("refreshToken")).toBe(false); // nothing written back for the other tabs
    expect(mocks.revokeRefreshToken).toHaveBeenCalledWith("rt-1"); // tab one's logout
    expect(mocks.revokeRefreshToken).toHaveBeenCalledWith("rt-2"); // tab two's stray token

    // "Reloading" tab one: still signed out.
    expect(openTab().auth.status).toBe("guest");
  });

  it("a transient failure keeps the session and rejects with the original error", async () => {
    const { two } = twoSignedInTabs();
    const cold = { response: { status: 503 } };
    mocks.refresh.mockRejectedValueOnce(cold);
    await expect(two.auth.handleTokenRefresh()).rejects.toBe(cold);
    expect(two.auth.refreshToken).toBe("rt-1");
    expect(two.auth.status).toBe("loggedIn");
  });
});

describe("tabs take turns refreshing (Web Locks)", () => {
  it("two tabs refreshing at the same moment: one server refresh, the same tokens in both, nobody logged out", async () => {
    const { one, two } = twoSignedInTabs();
    const server = rotatingServer();

    await Promise.all([one.auth.handleTokenRefresh(), two.auth.handleTokenRefresh()]);

    expect(server.calls).toBe(1);
    expect(locks.requests).toBe(2);
    for (const tab of [one, two]) {
      expect(tab.auth.status).toBe("loggedIn");
      expect(tab.auth.refreshToken).toBe("rt-2");
      expect(tab.auth.accessToken).toBe(access("user-1", 2));
      expect(tab.auth.sessionEpoch).toBe(0);
    }
    expect(storage.get("refreshToken")).toBe("rt-2");
    expect(server.stored).toBe("rt-2");
    expect(mocks.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it("inside the lock, tokens another tab already rotated are adopted without asking the server", async () => {
    const { two } = twoSignedInTabs();
    const server = rotatingServer();
    // Another tab rotated a moment ago; its storage event has not reached tab two yet.
    storage.set("accessToken", access("user-1", 7));
    storage.set("refreshToken", "rt-7");

    await two.auth.handleTokenRefresh();

    expect(server.calls).toBe(0);
    expect(two.auth.refreshToken).toBe("rt-7");
    expect(two.auth.sessionEpoch).toBe(0);
  });

  it("a tab that logged out while waiting for the lock never calls the server", async () => {
    const { one, two } = twoSignedInTabs();
    const server = rotatingServer();
    let release!: () => void;
    // Another tab holds the lock (its refresh is still running).
    void locks.request(TOKEN_REFRESH_LOCK, () => new Promise<void>((resolve) => (release = resolve)));

    const waiting = two.auth.handleTokenRefresh();
    await two.auth.logout();
    release();

    await expect(waiting).rejects.toBeInstanceOf(SessionChangedError);
    expect(server.calls).toBe(0);
    expect(one.auth.refreshToken).toBe("rt-1"); // tab one hears about the logout via its storage event
  });
});

describe("without Web Locks (old browsers): best effort, as before", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", {});
  });

  it("two tabs refreshing at once: the loser adopts the winner's tokens instead of logging out", async () => {
    const { one, two } = twoSignedInTabs();
    const server = rotatingServer();

    await Promise.all([one.auth.handleTokenRefresh(), two.auth.handleTokenRefresh()]);

    expect(server.calls).toBe(2);
    expect(one.auth.refreshToken).toBe("rt-2");
    expect(two.auth.refreshToken).toBe("rt-2");
    expect(two.auth.status).toBe("loggedIn");
    expect(mocks.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it("the server answers both with the same pair: the pair another tab stored is never revoked", async () => {
    const { one, two } = twoSignedInTabs();
    const server = rotatingServer({ samePairForConcurrent: true });

    await Promise.all([one.auth.handleTokenRefresh(), two.auth.handleTokenRefresh()]);

    expect(server.calls).toBe(2);
    expect(one.auth.refreshToken).toBe("rt-2");
    expect(two.auth.refreshToken).toBe("rt-2");
    expect(storage.get("refreshToken")).toBe("rt-2");
    expect(mocks.revokeRefreshToken).not.toHaveBeenCalledWith("rt-2");
  });

  it("refused because another tab rotated first: this tab carries on with that tab's tokens", async () => {
    const { one, two } = twoSignedInTabs();
    let fail!: (error: unknown) => void;
    mocks.refresh.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    const refreshing = two.auth.handleTokenRefresh();

    mocks.refresh.mockResolvedValueOnce({ accessToken: access("user-1", 2), refreshToken: "rt-2" });
    await one.auth.handleTokenRefresh(); // tab one wins the rotation
    fail({ response: { status: 401 } }); // tab two's refresh with the old token is refused

    await expect(refreshing).resolves.toBeUndefined();
    expect(two.auth.refreshToken).toBe("rt-2");
    expect(two.auth.status).toBe("loggedIn");
    expect(two.auth.sessionEpoch).toBe(0);
  });

  it("succeeded while another tab stored newer tokens: ours are discarded + revoked, theirs adopted", async () => {
    const { one, two } = twoSignedInTabs();
    let answer!: (tokens: { accessToken: string; refreshToken: string }) => void;
    mocks.refresh.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const refreshing = two.auth.handleTokenRefresh();

    one.auth._setTokens(access("user-1", 3), "rt-3");
    answer({ accessToken: access("user-1", 2), refreshToken: "rt-2" });

    await expect(refreshing).resolves.toBeUndefined();
    expect(two.auth.refreshToken).toBe("rt-3");
    expect(storage.get("refreshToken")).toBe("rt-3");
    expect(mocks.revokeRefreshToken).toHaveBeenCalledWith("rt-2");
    expect(mocks.revokeRefreshToken).not.toHaveBeenCalledWith("rt-3"); // never the stored token
  });
});
