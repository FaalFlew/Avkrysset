/**
 * Where a sign-in goes next. `?redirect=` comes from the URL, so it must never send the user to
 * another site (open redirect); a remembered invitation link brings an invitee back after
 * creating an account, but only for 7 days. And the org-page access decision.
 */
import { describe, expect, it } from "vitest";
import {
  PENDING_INVITATION_KEY,
  PENDING_INVITATION_TTL_MS,
  loginLocation,
  postLoginPath,
  readPendingInvitation,
  safeRedirect,
  savePendingInvitation,
} from "../authRedirect";
import { decideOrgAccess, NOT_A_MEMBER_MESSAGE } from "../orgAccess";
import { isCompleteJoinCode, normalizeJoinCode } from "../joinCode";
import { now, toApiInstant } from "../datetime";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe("safeRedirect", () => {
  it("keeps paths on this site, with query and hash", () => {
    expect(safeRedirect("/orgs/9f0c2b4e-1d2a-4c3b-8e7f-0a1b2c3d4e5f/board")).toBe(
      "/orgs/9f0c2b4e-1d2a-4c3b-8e7f-0a1b2c3d4e5f/board"
    );
    expect(safeRedirect("/invitations/abc_DEF-123?x=1#top")).toBe("/invitations/abc_DEF-123?x=1#top");
    expect(safeRedirect(["/settings", "/other"])).toBe("/settings");
  });

  it.each([
    ["absolute URL", "https://evil.example/orgs"],
    ["protocol-relative", "//evil.example"],
    ["backslash after the slash", "/\\evil.example"],
    ["backslash later on", "/orgs\\..\\..\\evil"],
    ["tab that browsers strip", "/\t/evil.example"],
    ["newline", "/\n/evil.example"],
    ["javascript: URL", "javascript:alert(1)"],
    ["relative path", "orgs"],
    ["empty", ""],
    ["not a string", 42],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(safeRedirect(value)).toBeNull();
  });
});

describe("loginLocation", () => {
  it("sends a guest to log in with the page to come back to and why", () => {
    expect(loginLocation("/orgs/x/board?y=1", "orgs")).toEqual({
      path: "/login",
      query: { redirect: "/orgs/x/board?y=1", reason: "orgs" },
    });
    expect(loginLocation("/settings")).toEqual({ path: "/login", query: { redirect: "/settings" } });
  });
});

describe("postLoginPath", () => {
  it("prefers a safe redirect, then a pending invitation, then the planner", () => {
    const storage = memoryStorage();
    expect(postLoginPath(undefined, storage)).toBe("/");
    savePendingInvitation("tok_123-abc", storage);
    expect(postLoginPath(undefined, storage)).toBe("/invitations/tok_123-abc");
    expect(postLoginPath("/orgs", storage)).toBe("/orgs");
    // An unsafe redirect is ignored (not followed).
    expect(postLoginPath("//evil.example", storage)).toBe("/invitations/tok_123-abc");
  });

  it("forgets an invitation after 7 days, and broken entries", () => {
    const storage = memoryStorage();
    const savedAt = now();
    storage.setItem(PENDING_INVITATION_KEY, JSON.stringify({ token: "t1", savedAt: toApiInstant(savedAt) }));
    expect(readPendingInvitation(storage, savedAt + PENDING_INVITATION_TTL_MS - 1)).toBe("t1");
    expect(readPendingInvitation(storage, savedAt + PENDING_INVITATION_TTL_MS)).toBeNull();
    expect(storage.map.has(PENDING_INVITATION_KEY)).toBe(false);

    storage.setItem(PENDING_INVITATION_KEY, "{not json");
    expect(readPendingInvitation(storage)).toBeNull();
    storage.setItem(PENDING_INVITATION_KEY, JSON.stringify({ token: "t2" }));
    expect(readPendingInvitation(storage)).toBeNull();
  });

  it("survives storage that throws (private mode)", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => savePendingInvitation("t", broken)).not.toThrow();
    expect(postLoginPath(undefined, broken)).toBe("/");
  });
});

describe("decideOrgAccess", () => {
  it("renders members, sends non-members to /orgs with a toast, and keeps the URL on errors", () => {
    expect(decideOrgAccess("active")).toEqual({ kind: "render" });
    expect(decideOrgAccess("missing")).toEqual({ kind: "redirect", to: "/orgs", message: NOT_A_MEMBER_MESSAGE });
    expect(decideOrgAccess("error")).toEqual({ kind: "error" });
  });
});

describe("join codes", () => {
  it("accepts codes the way people paste them", () => {
    expect(normalizeJoinCode(" abcd-2345 ")).toBe("ABCD2345");
    expect(normalizeJoinCode("ab cd 23 45")).toBe("ABCD2345");
    expect(normalizeJoinCode("ABCD–2345")).toBe("ABCD2345"); // en dash
    expect(isCompleteJoinCode("abcd-2345")).toBe(true);
    expect(isCompleteJoinCode("ABCD234")).toBe(false);
    expect(isCompleteJoinCode("ABCD23456")).toBe(false);
    expect(isCompleteJoinCode("ABCD#345")).toBe(false);
  });
});
