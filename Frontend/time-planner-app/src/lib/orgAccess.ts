// src/lib/orgAccess.ts — what an org page does with the result of the membership check.
//
// The check lives in OrgLayout (not in the router guard), so a cold server never freezes
// navigation: the layout renders a skeleton while orgStore.ensureMembership(orgId) runs, then
// follows decideOrgAccess().

export type MembershipCheck = "active" | "missing" | "error";

export type OrgAccessDecision =
  /** Render the org page (`<RouterView :key="orgId">`). */
  | { kind: "render" }
  /** Not a member (never joined, left, removed, or no such org): toast + replace the route. */
  | { kind: "redirect"; to: string; message: string }
  /** The check failed (network, 5xx): error state with Retry; stay on the URL. */
  | { kind: "error" };

export const NOT_A_MEMBER_MESSAGE = "You're not a member of that organization.";
export const ORGS_PATH = "/orgs";

export function decideOrgAccess(result: MembershipCheck): OrgAccessDecision {
  switch (result) {
    case "active":
      return { kind: "render" };
    case "missing":
      return { kind: "redirect", to: ORGS_PATH, message: NOT_A_MEMBER_MESSAGE };
    case "error":
      return { kind: "error" };
  }
}

/** Document title of an org page: "Board · Acme · Time Planner" ("Board · Time Planner" before the name is known). */
export function orgDocumentTitle(page: string | null | undefined, orgName: string | null | undefined): string {
  return [page, orgName?.trim(), "Time Planner"].filter(Boolean).join(" · ");
}
