// src/stores/orgStore.ts — the signed-in user's organizations, their invitation inbox, and
// membership checks for org pages.
//
// Session safety (docs/plans/auth-session-race.md): every request runs in sessionBound(), so an
// answer that arrives after a logout / new login is dropped (SessionChangedError) and never
// written into the next session; the whole state is reset when the session epoch changes
// (setupOrgStoreSubscribers). A 403 from an /organizations/{id}/… endpoint re-checks that
// membership (the role may have changed, or the membership ended).
//
// Errors of user actions (create, join, accept, …) are thrown to the caller, which shows them
// inline (apiErrorMessage). SessionChangedError must be ignored by callers.

import { defineStore } from "pinia";
import { watch } from "vue";
import { sessionBound, useAuthStore } from "./authStore";
import { orgService } from "@/services/orgService";
import { onForbidden } from "@/services/apiService";
import { apiErrorMessage, httpStatus, isSessionChangedError } from "@/lib/apiErrors";
import type { MembershipCheck } from "@/lib/orgAccess";
import type {
  CreateOrganizationInput,
  Invitation,
  Membership,
  OrgRole,
  Organization,
  SelectableMember,
} from "@/types/org";

export const ORGS_LOAD_ERROR = "Couldn't load your organizations.";

/** Accept/decline an invitation by its id (inbox) or by the token of the email link. */
export type InvitationRef = { id: string } | { token: string };

const byName = (a: Organization, b: Organization) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Request bookkeeping (not reactive state), keyed by the session epoch so a new session never
// joins a request of the previous one.
let mineRequest: { epoch: number; promise: Promise<void> } | null = null;
const membershipRequests = new Map<string, { epoch: number; promise: Promise<MembershipCheck> }>();
const selectableRequests = new Map<string, { epoch: number; promise: Promise<SelectableMember[]> }>();

type MembershipLostListener = (orgId: string) => void;
const membershipLostListeners = new Set<MembershipLostListener>();

/**
 * Be told when a membership turns out to be gone (a re-check after a 403, or a self event later in
 * 3G): OrgLayout uses it to leave the org's pages. Returns the unsubscribe function.
 */
export function onMembershipLost(listener: MembershipLostListener): () => void {
  membershipLostListeners.add(listener);
  return () => membershipLostListeners.delete(listener);
}

function notifyMembershipLost(orgId: string): void {
  for (const listener of [...membershipLostListeners]) {
    try {
      listener(orgId);
    } catch (error) {
      console.error("Membership listener failed:", error);
    }
  }
}

/** 404 (and a 403 that reached a membership check) means "not a member". */
function isMissing(error: unknown): boolean {
  const status = httpStatus(error);
  return status === 404 || status === 403;
}

export const useOrgStore = defineStore("orgs", {
  state: () => ({
    /** Active memberships, by name. */
    orgs: [] as Organization[],
    /** Inbox: pending, unexpired invitations to my email. */
    invitations: [] as Invitation[],
    /** The list has been loaded in this session. */
    loaded: false,
    isLoading: false,
    loadError: null as string | null,
    /** Assignable members per org (O/A), cached for the session. */
    selectable: {} as Record<string, SelectableMember[]>,
  }),

  getters: {
    orgById:
      (state) =>
      (orgId: string | null | undefined): Organization | undefined =>
        orgId ? state.orgs.find((o) => sameId(o.id, orgId)) : undefined,
    roleIn(): (orgId: string | null | undefined) => OrgRole | null {
      return (orgId) => this.orgById(orgId)?.myRole ?? null;
    },
    pendingInvitationCount: (state) => state.invitations.length,
  },

  actions: {
    /** Forget everything (the session changed). */
    reset() {
      this.orgs = [];
      this.invitations = [];
      this.loaded = false;
      this.isLoading = false;
      this.loadError = null;
      this.selectable = {};
      mineRequest = null;
      membershipRequests.clear();
      selectableRequests.clear();
    },

    /**
     * My organizations + invitation inbox. One request at a time per session (callers share the
     * one in flight). Fired after sign-in; pages may call it again to refresh.
     */
    loadMine(): Promise<void> {
      const auth = useAuthStore();
      if (!auth.isAuthenticated) return Promise.resolve();
      const epoch = auth.sessionEpoch;
      if (mineRequest && mineRequest.epoch === epoch) return mineRequest.promise;

      const run = async () => {
        this.isLoading = true;
        try {
          const [orgs, invitations] = await Promise.allSettled([
            sessionBound(() => orgService.getMyOrganizations()),
            sessionBound(() => orgService.getMyInvitations()),
          ]);
          if (auth.sessionEpoch !== epoch) return;
          if (orgs.status === "fulfilled") {
            this.orgs = [...orgs.value].sort(byName);
            this.loaded = true;
            this.loadError = null;
          } else if (!isSessionChangedError(orgs.reason)) {
            this.loadError = apiErrorMessage(orgs.reason, ORGS_LOAD_ERROR);
          }
          if (invitations.status === "fulfilled") {
            this.invitations = invitations.value.filter((i) => i.status === "Pending");
          }
        } finally {
          if (auth.sessionEpoch === epoch) this.isLoading = false;
        }
      };

      const promise = run().finally(() => {
        if (mineRequest?.promise === promise) mineRequest = null;
      });
      mineRequest = { epoch, promise };
      return promise;
    },

    /**
     * Is the signed-in user an active member of `orgId`? The cached list answers first (when it
     * knows my role), else `GET …/members/me`. Never throws:
     * - "active"  — the org (with my role) is in `orgs`;
     * - "missing" — never joined, left, removed, or no such org (404); dropped from `orgs`;
     * - "error"   — network/server trouble (or the session changed): show Retry.
     */
    ensureMembership(orgId: string): Promise<MembershipCheck> {
      if (this.orgById(orgId)?.myRole) return Promise.resolve("active");
      return this.checkMembership(orgId);
    },

    /** Re-check a membership with the server (after a 403): updates my role or drops the org. */
    refreshMembership(orgId: string): Promise<MembershipCheck> {
      return this.checkMembership(orgId);
    },

    /** Shared by ensureMembership/refreshMembership: one check per org at a time. */
    checkMembership(orgId: string): Promise<MembershipCheck> {
      const auth = useAuthStore();
      if (!auth.isAuthenticated) return Promise.resolve("missing");
      const epoch = auth.sessionEpoch;
      const key = orgId.toLowerCase();
      const pending = membershipRequests.get(key);
      if (pending && pending.epoch === epoch) return pending.promise;

      const run = async (): Promise<MembershipCheck> => {
        let membership: Membership;
        try {
          membership = await sessionBound(() => orgService.getMyMembership(orgId));
        } catch (error) {
          if (isSessionChangedError(error)) return "error";
          if (isMissing(error)) {
            this.handleMembershipLost(orgId);
            return "missing";
          }
          return "error";
        }
        if (membership.status !== "Active") {
          this.handleMembershipLost(orgId);
          return "missing";
        }

        const cached = this.orgById(orgId);
        if (cached) {
          this.setRole(cached.id, membership.role);
          return "active";
        }
        try {
          const org = await sessionBound(() => orgService.getOrganization(orgId));
          this.upsertLocal({ ...org, myRole: org.myRole ?? membership.role });
          return "active";
        } catch (error) {
          if (isSessionChangedError(error)) return "error";
          if (isMissing(error)) {
            this.handleMembershipLost(orgId);
            return "missing";
          }
          return "error";
        }
      };

      const promise = run().finally(() => {
        if (membershipRequests.get(key)?.promise === promise) membershipRequests.delete(key);
      });
      membershipRequests.set(key, { epoch, promise });
      return promise;
    },

    /** The membership is gone: drop the org and tell OrgLayout (toast + leave its pages). */
    handleMembershipLost(orgId: string) {
      const known = !!this.orgById(orgId);
      this.removeLocal(orgId);
      if (known) notifyMembershipLost(orgId);
    },

    /** Create an organization (I become its owner). The zone defaults to mine on the server. */
    async create(input: CreateOrganizationInput): Promise<Organization> {
      const org = await sessionBound(() => orgService.createOrganization(input));
      this.upsertLocal({ ...org, myRole: org.myRole ?? "Owner" });
      return this.orgById(org.id) ?? org;
    },

    /** Join with a code. Resolves with the new membership; the org is added to `orgs`. */
    async joinWithCode(code: string): Promise<Membership> {
      const membership = await sessionBound(() => orgService.joinOrganization(code));
      await this.adoptMembership(membership);
      return membership;
    },

    /** Accept an invitation (inbox: by id; email link: by token). */
    async acceptInvitation(ref: InvitationRef): Promise<Membership> {
      const membership = await sessionBound(() =>
        "id" in ref ? orgService.acceptInvitationById(ref.id) : orgService.acceptInvitationByToken(ref.token)
      );
      this.invitations = this.invitations.filter((i) =>
        "id" in ref ? !sameId(i.id, ref.id) : !sameId(i.organizationId, membership.organizationId)
      );
      await this.adoptMembership(membership);
      return membership;
    },

    async declineInvitation(ref: InvitationRef): Promise<void> {
      await sessionBound(() =>
        "id" in ref ? orgService.declineInvitationById(ref.id) : orgService.declineInvitationByToken(ref.token)
      );
      if ("id" in ref) this.removeInvitationLocal(ref.id);
    },

    /** A membership I just got (join/accept): load the org into the list. */
    async adoptMembership(membership: Membership): Promise<void> {
      try {
        const org = await sessionBound(() => orgService.getOrganization(membership.organizationId));
        this.upsertLocal({ ...org, myRole: org.myRole ?? membership.role });
      } catch (error) {
        if (isSessionChangedError(error)) throw error;
        // The membership exists; the list just couldn't be refreshed right now.
        void this.loadMine();
      }
    },

    /** Leave an organization (not allowed for the owner). */
    async leave(orgId: string): Promise<void> {
      await sessionBound(() => orgService.leaveOrganization(orgId));
      this.removeLocal(orgId);
    },

    /** Drop an org from the local state (left, deleted, removed). */
    removeLocal(orgId: string) {
      this.orgs = this.orgs.filter((o) => !sameId(o.id, orgId));
      const selectable = { ...this.selectable };
      delete selectable[orgId];
      this.selectable = selectable;
      selectableRequests.delete(orgId.toLowerCase());
    },

    /**
     * Insert or replace an org (kept sorted by name). A payload without my role (hub events) keeps
     * the role and join codes already known.
     */
    upsertLocal(org: Organization) {
      const existing = this.orgById(org.id);
      const merged: Organization =
        existing && org.myRole === null
          ? {
              ...org,
              myRole: existing.myRole,
              memberJoinCode: existing.memberJoinCode,
              memberJoinCodeExpiryUtc: existing.memberJoinCodeExpiryUtc,
              adminJoinCode: existing.adminJoinCode,
              adminJoinCodeExpiryUtc: existing.adminJoinCodeExpiryUtc,
            }
          : org;
      this.orgs = [...this.orgs.filter((o) => !sameId(o.id, org.id)), merged].sort(byName);
    },

    /** My role changed (re-check, or a role event): members never keep the join codes. */
    setRole(orgId: string, role: OrgRole) {
      const org = this.orgById(orgId);
      if (!org || org.myRole === role) return;
      const codes =
        role === "Member"
          ? { memberJoinCode: null, memberJoinCodeExpiryUtc: null, adminJoinCode: null, adminJoinCodeExpiryUtc: null }
          : {};
      this.upsertLocal({ ...org, ...codes, myRole: role });
    },

    removeInvitationLocal(inviteId: string) {
      this.invitations = this.invitations.filter((i) => !sameId(i.id, inviteId));
    },

    /** Assignable (active) members of an org, cached per session; `force` refetches. O/A only. */
    selectableMembers(orgId: string, options: { force?: boolean } = {}): Promise<SelectableMember[]> {
      const auth = useAuthStore();
      const epoch = auth.sessionEpoch;
      const cached = this.selectable[orgId];
      if (cached && !options.force) return Promise.resolve(cached);
      const key = orgId.toLowerCase();
      const pending = selectableRequests.get(key);
      if (pending && pending.epoch === epoch) return pending.promise;

      const promise = sessionBound(() => orgService.getSelectableMembers(orgId))
        .then((members) => {
          if (this.orgById(orgId)) this.selectable = { ...this.selectable, [orgId]: members };
          return members;
        })
        .finally(() => {
          if (selectableRequests.get(key)?.promise === promise) selectableRequests.delete(key);
        });
      selectableRequests.set(key, { epoch, promise });
      return promise;
    },
  },
});

/**
 * Wire the org store to the session (main.ts, once): reset on every session change, load my
 * organizations once a session starts, and re-check a membership whenever one of its endpoints
 * answers 403. Returns the function that stops all of it.
 */
export function setupOrgStoreSubscribers(): () => void {
  const auth = useAuthStore();
  const store = useOrgStore();
  const stopReset = watch(
    () => auth.sessionEpoch,
    () => store.reset(),
    { flush: "sync" }
  );
  const stopLoad = watch(
    () => [auth.isAuthenticated, auth.sessionEpoch] as const,
    ([isAuthenticated]) => {
      if (isAuthenticated) void store.loadMine();
    },
    { immediate: true }
  );
  const stopForbidden = onForbidden((info) => {
    if (info.organizationId && auth.isAuthenticated) void store.refreshMembership(info.organizationId);
  });
  return () => {
    stopReset();
    stopLoad();
    stopForbidden();
  };
}
