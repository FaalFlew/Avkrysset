/**
 * orgStore: answers of an earlier session never land in the next one (a cold server answering
 * after logout / a new login), membership checks decide what an org URL shows, and a 403 re-check
 * updates my role or drops the org. The services are mocked; no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Membership, Organization } from "@/types/org";
import type { ForbiddenInfo } from "@/services/apiService";

let forbiddenListener: ((info: ForbiddenInfo) => void) | null = null;
vi.mock("@/services/apiService", () => ({
  default: {},
  abortSessionRequests: vi.fn(),
  onForbidden: vi.fn((listener: (info: ForbiddenInfo) => void) => {
    forbiddenListener = listener;
    return () => {
      forbiddenListener = null;
    };
  }),
}));
vi.mock("@/services/authService", () => ({ authService: { revokeRefreshToken: vi.fn() } }));
vi.mock("@/services/orgService", () => ({
  orgService: {
    getMyOrganizations: vi.fn(),
    getMyInvitations: vi.fn(),
    getMyMembership: vi.fn(),
    getOrganization: vi.fn(),
  },
}));

import { orgService } from "@/services/orgService";
import { useAuthStore } from "../authStore";
import { onMembershipLost, setupOrgStoreSubscribers, useOrgStore } from "../orgStore";

const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, String(value)),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
  },
});
(globalThis as { window?: unknown }).window ??= globalThis;

const api = vi.mocked(orgService);
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const ACME = "9f0c2b4e-1d2a-4c3b-8e7f-0a1b2c3d4e5f";

function org(id: string, name: string, myRole: Organization["myRole"] = "Admin"): Organization {
  return {
    id,
    name,
    ownerId: "owner",
    timeZoneId: "America/New_York",
    color: "#2F7FE0",
    myRole,
    memberJoinCode: myRole === "Member" ? null : "ABCD2345",
    memberJoinCodeExpiryUtc: myRole === "Member" ? null : "2026-11-01T00:00:00.000Z",
    adminJoinCode: myRole === "Member" ? null : "WXYZ6789",
    adminJoinCodeExpiryUtc: myRole === "Member" ? null : "2026-11-01T00:00:00.000Z",
  };
}

function membership(role: Membership["role"], status: Membership["status"] = "Active"): Membership {
  return {
    membershipId: "m1",
    organizationId: ACME,
    organizationName: "Acme",
    userId: "me",
    userEmail: "me@example.com",
    displayName: "Me",
    role,
    status,
    statusMessage: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const networkError = () => Object.assign(new Error("Network Error"), { code: "ERR_NETWORK", request: {} });

function signIn(user: string) {
  useAuthStore()._startSession(`access-${user}`, `refresh-${user}`);
}

beforeEach(() => {
  memory.clear();
  vi.clearAllMocks();
  setActivePinia(createPinia());
  api.getMyInvitations.mockResolvedValue([]);
});

describe("session safety", () => {
  it("drops a late org list of the previous session and never joins its request", async () => {
    const store = useOrgStore();
    const stop = setupOrgStoreSubscribers();
    const first = deferred<Organization[]>();
    api.getMyOrganizations.mockReturnValueOnce(first.promise);
    signIn("a");
    await flush(); // the subscriber starts loadMine for user A
    expect(api.getMyOrganizations).toHaveBeenCalledTimes(1);

    // User A logs out, user B logs in while A's answer is still on its way.
    useAuthStore()._clearTokens();
    api.getMyOrganizations.mockResolvedValueOnce([org("b-org", "Beta")]);
    signIn("b");
    await flush();
    expect(api.getMyOrganizations).toHaveBeenCalledTimes(2); // B's own request
    expect(store.orgs.map((o) => o.name)).toEqual(["Beta"]);

    first.resolve([org(ACME, "Acme (user A)")]);
    await flush();
    expect(store.orgs.map((o) => o.name)).toEqual(["Beta"]);
    stop();
  });

  it("ignores a membership answer that arrives after logout", async () => {
    const store = useOrgStore();
    const stop = setupOrgStoreSubscribers();
    api.getMyOrganizations.mockResolvedValue([]);
    signIn("a");
    await flush();
    const pending = deferred<Membership>();
    api.getMyMembership.mockReturnValueOnce(pending.promise);
    api.getOrganization.mockResolvedValue(org(ACME, "Acme"));

    const check = store.ensureMembership(ACME);
    useAuthStore()._clearTokens();
    pending.resolve(membership("Admin"));

    expect(await check).toBe("error");
    expect(store.orgs).toEqual([]);
    expect(api.getOrganization).not.toHaveBeenCalled();
    stop();
  });
});

describe("ensureMembership", () => {
  beforeEach(() => {
    signIn("a");
  });

  it("answers from the cached list without a request when my role is known", async () => {
    const store = useOrgStore();
    store.orgs = [org(ACME, "Acme")];
    expect(await store.ensureMembership(ACME.toUpperCase())).toBe("active");
    expect(api.getMyMembership).not.toHaveBeenCalled();
  });

  it("loads an org that isn't cached yet, with my role from the membership", async () => {
    const store = useOrgStore();
    api.getMyMembership.mockResolvedValue(membership("Member"));
    api.getOrganization.mockResolvedValue({ ...org(ACME, "Acme"), myRole: null });
    expect(await store.ensureMembership(ACME)).toBe("active");
    expect(store.orgById(ACME)?.myRole).toBe("Member");
  });

  it("treats 404 and a former membership as missing, and drops the org", async () => {
    const store = useOrgStore();
    store.orgs = [{ ...org(ACME, "Acme"), myRole: null }];
    api.getMyMembership.mockRejectedValueOnce(httpError(404));
    expect(await store.ensureMembership(ACME)).toBe("missing");
    expect(store.orgs).toEqual([]);

    api.getMyMembership.mockResolvedValueOnce(membership("Member", "Removed"));
    expect(await store.ensureMembership(ACME)).toBe("missing");
  });

  it("reports server trouble as an error and keeps what it knew", async () => {
    const store = useOrgStore();
    store.orgs = [{ ...org(ACME, "Acme"), myRole: null }];
    api.getMyMembership.mockRejectedValueOnce(networkError());
    expect(await store.ensureMembership(ACME)).toBe("error");
    api.getMyMembership.mockRejectedValueOnce(httpError(503));
    expect(await store.ensureMembership(ACME)).toBe("error");
    expect(store.orgs).toHaveLength(1);
  });
});

describe("403 re-check", () => {
  it("updates my role (members lose the join codes) or drops the org and says so", async () => {
    const store = useOrgStore();
    const stop = setupOrgStoreSubscribers();
    api.getMyOrganizations.mockResolvedValue([org(ACME, "Acme", "Admin")]);
    signIn("a");
    await flush();
    expect(store.orgById(ACME)?.myRole).toBe("Admin");

    // Demoted meanwhile: an admin endpoint answers 403.
    api.getMyMembership.mockResolvedValueOnce(membership("Member"));
    forbiddenListener?.({ url: `/organizations/${ACME}/join-codes`, organizationId: ACME });
    await flush();
    expect(store.orgById(ACME)?.myRole).toBe("Member");
    expect(store.orgById(ACME)?.memberJoinCode).toBeNull();

    // Removed meanwhile.
    const lost: string[] = [];
    const unsubscribe = onMembershipLost((id) => lost.push(id));
    api.getMyMembership.mockRejectedValueOnce(httpError(404));
    forbiddenListener?.({ url: `/organizations/${ACME}/members`, organizationId: ACME });
    await flush();
    expect(store.orgById(ACME)).toBeUndefined();
    expect(lost).toEqual([ACME]);
    unsubscribe();
    stop();
  });
});
