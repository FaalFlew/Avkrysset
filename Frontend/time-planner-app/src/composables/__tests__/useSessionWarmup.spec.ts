/**
 * useSessionWarmup: with a stored session, ping GET /api/health on app load and when the tab
 * comes back after a long time away, and refresh an expired access token in the background
 * (before the user acts). Guests: nothing. Ping/refresh/clock/events are injected fakes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { expiredAccessToken, installBrowserGlobals, makeJwt, validAccessToken } from "@/services/__tests__/fakeApi";

vi.mock("@/services/apiService", () => ({
  refreshSessionInBackground: vi.fn(async () => true),
  wakeServer: vi.fn(async () => undefined),
  abortSessionRequests: vi.fn(),
}));
vi.mock("@/services/authService", () => ({ authService: {} }));

import { EXPIRY_MARGIN_MS, LONG_AWAY_MS, installSessionWarmup } from "../useSessionWarmup";
import { refreshSessionInBackground, wakeServer } from "@/services/apiService";
import { useAuthStore } from "@/stores/authStore";

const storage = installBrowserGlobals();
/** The fake clock starts at the real time (tokens from fakeApi.ts expire relative to it). */
const T0 = Date.now();

function setup(accessToken: string | null, refreshToken: string | null = "refresh") {
  storage.clear();
  if (accessToken) storage.set("accessToken", accessToken);
  if (refreshToken) storage.set("refreshToken", refreshToken);
  setActivePinia(createPinia());
  const auth = useAuthStore();

  let clock = T0;
  let visibility = "visible";
  const doc = new EventTarget();
  const win = new EventTarget();
  const ping = vi.fn();
  const refresh = vi.fn();
  const stop = installSessionWarmup({
    ping,
    refresh,
    now: () => clock,
    visibility: () => visibility,
    document: doc,
    window: win,
  });
  return {
    auth,
    ping,
    refresh,
    stop,
    advance: (ms: number) => (clock += ms),
    hide: () => {
      visibility = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    show: () => {
      visibility = "visible";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    blur: () => win.dispatchEvent(new Event("blur")),
    focus: () => win.dispatchEvent(new Event("focus")),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("app load", () => {
  it("stored session with an expired access token: ping + background refresh", () => {
    const s = setup(expiredAccessToken());
    expect(s.ping).toHaveBeenCalledTimes(1);
    expect(s.refresh).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it("stored session with a valid token: ping only", () => {
    const s = setup(makeJwt({ sub: "u", exp: Math.floor(T0 / 1000) + 3600 }));
    expect(s.ping).toHaveBeenCalledTimes(1);
    expect(s.refresh).not.toHaveBeenCalled();
    s.stop();
  });

  it("a token about to expire (within the margin) is refreshed too", () => {
    const s = setup(makeJwt({ sub: "u", exp: Math.floor((T0 + EXPIRY_MARGIN_MS / 2) / 1000) }));
    expect(s.refresh).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it("guests: nothing to wake", () => {
    const s = setup(null, null);
    expect(s.ping).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
    s.stop();
  });
});

describe("tab return", () => {
  it("after a long time hidden: ping again (and refresh if the token expired meanwhile)", () => {
    const s = setup(makeJwt({ sub: "u", exp: Math.floor((T0 + LONG_AWAY_MS) / 1000) }));
    s.ping.mockClear();
    s.hide();
    s.advance(LONG_AWAY_MS + 1);
    s.show();
    expect(s.ping).toHaveBeenCalledTimes(1);
    expect(s.refresh).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it("after a short time: no ping; refresh only when the token expired", () => {
    const s = setup(validAccessToken());
    s.ping.mockClear();
    s.hide();
    s.advance(30_000);
    s.show();
    expect(s.ping).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();

    s.auth.accessToken = makeJwt({ sub: "u", exp: Math.floor(T0 / 1000) }); // expired at "now"
    s.hide();
    s.advance(1_000);
    s.show();
    expect(s.ping).not.toHaveBeenCalled();
    expect(s.refresh).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it("window blur → focus counts as away too, and visibility + focus together warm up once", () => {
    const s = setup(validAccessToken());
    s.ping.mockClear();
    s.blur();
    s.hide();
    s.advance(LONG_AWAY_MS);
    s.show();
    s.focus();
    expect(s.ping).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it("does nothing after logout, and nothing once uninstalled", () => {
    const s = setup(expiredAccessToken());
    s.ping.mockClear();
    s.refresh.mockClear();
    s.auth._clearTokens();
    s.hide();
    s.advance(LONG_AWAY_MS);
    s.show();
    expect(s.ping).not.toHaveBeenCalled();

    s.stop();
    s.auth.accessToken = expiredAccessToken();
    s.auth.refreshToken = "refresh";
    s.hide();
    s.advance(LONG_AWAY_MS);
    s.show();
    expect(s.ping).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
  });
});

describe("default dependencies", () => {
  it("use wakeServer and refreshSessionInBackground", () => {
    storage.clear();
    storage.set("accessToken", expiredAccessToken());
    storage.set("refreshToken", "refresh");
    setActivePinia(createPinia());
    const doc = new EventTarget();
    const stop = installSessionWarmup({ document: doc, window: new EventTarget(), visibility: () => "visible" });
    expect(wakeServer).toHaveBeenCalledTimes(1);
    expect(refreshSessionInBackground).toHaveBeenCalledTimes(1);
    stop();
  });
});
