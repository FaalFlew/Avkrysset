/**
 * The current user's id for "you" in org task wording: read from the access token's `sub`
 * claim; if the token can't be read, GET /api/users/me once per session (cached).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const getMyProfile = vi.hoisted(() => vi.fn());
vi.mock("@/services/apiDataService", () => ({ apiDataService: { getMyProfile } }));
vi.mock("@/services/authService", () => ({ authService: {} }));

import { resetCurrentUserCache, useCurrentUserId, userIdFromToken } from "../useCurrentUser";
import { useAuthStore } from "@/stores/authStore";

const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, String(value)),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
  },
});

const USER_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.signature`;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  memory.clear();
  setActivePinia(createPinia());
  resetCurrentUserCache();
  getMyProfile.mockReset();
});

describe("userIdFromToken", () => {
  it("reads the sub claim (base64url payload, unpadded)", () => {
    expect(userIdFromToken(jwt({ sub: USER_ID, email: "carol@example.com", exp: 1 }))).toBe(USER_ID);
    // Payload bytes that become '-' and '_' in base64url, and non-ASCII claims.
    expect(userIdFromToken(jwt({ sub: USER_ID, name: "Øyvind ~~~???>>>" }))).toBe(USER_ID);
  });

  it("falls back to the nameidentifier claim", () => {
    const claim = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier";
    expect(userIdFromToken(jwt({ [claim]: USER_ID }))).toBe(USER_ID);
  });

  it("null for missing or unreadable tokens", () => {
    expect(userIdFromToken(null)).toBeNull();
    expect(userIdFromToken("")).toBeNull();
    expect(userIdFromToken("not-a-jwt")).toBeNull();
    expect(userIdFromToken("a.%%%.c")).toBeNull();
    expect(userIdFromToken(jwt({ email: "x@example.com" }))).toBeNull();
  });
});

describe("useCurrentUserId", () => {
  it("guests have no id", () => {
    expect(useCurrentUserId().value).toBeNull();
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it("signed in: the token's id, no request", () => {
    useAuthStore().accessToken = jwt({ sub: USER_ID });
    expect(useCurrentUserId().value).toBe(USER_ID);
    expect(getMyProfile).not.toHaveBeenCalled();
  });

  it("unreadable token: GET /users/me once, cached for the session", async () => {
    const auth = useAuthStore();
    auth.accessToken = "opaque-token";
    auth.refreshToken = "refresh-1";
    getMyProfile.mockResolvedValue({ id: USER_ID, email: "carol@example.com", displayName: "Carol" });

    const first = useCurrentUserId();
    expect(first.value).toBeNull(); // pending
    const second = useCurrentUserId();
    void second.value;
    await flush();
    expect(first.value).toBe(USER_ID);
    expect(second.value).toBe(USER_ID);
    expect(useCurrentUserId().value).toBe(USER_ID);
    expect(getMyProfile).toHaveBeenCalledTimes(1);

    // Another session (new login) asks again.
    auth.refreshToken = "refresh-2";
    getMyProfile.mockResolvedValue({ id: "someone-else", email: "o@example.com", displayName: null });
    const third = useCurrentUserId();
    expect(third.value).toBeNull();
    await flush();
    expect(third.value).toBe("someone-else");
    expect(getMyProfile).toHaveBeenCalledTimes(2);
  });

  it("a failed profile request is retried later, not cached", async () => {
    const auth = useAuthStore();
    auth.accessToken = "opaque-token";
    auth.refreshToken = "refresh-1";
    getMyProfile.mockRejectedValueOnce(new Error("offline"));
    expect(useCurrentUserId().value).toBeNull();
    await flush();
    getMyProfile.mockResolvedValue({ id: USER_ID, email: "c@example.com", displayName: null });
    const again = useCurrentUserId();
    expect(again.value).toBeNull();
    await flush();
    expect(again.value).toBe(USER_ID);
    expect(getMyProfile).toHaveBeenCalledTimes(2);
  });
});
