// src/types/org.ts — organization DTOs and request bodies (docs/plans/organizations-phase3.md §2.1).
// Instants are canonical UTC strings with Z (normalized by services/orgService.ts).

import type { UtcIsoString } from "@/lib/datetime";
import type { AnalyticsView } from "@/lib/analyticsBuckets";

export type OrgRole = "Owner" | "Admin" | "Member";
/** Roles an invitation or a role change can grant (ownership moves only by transfer). */
export type AssignableRole = "Admin" | "Member";
export type MembershipStatus = "Active" | "Left" | "Removed";
export type InvitationStatus = "Pending" | "Accepted" | "Declined" | "Rescinded" | "Expired";

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  /** IANA zone; org analytics/reports bucket in it. */
  timeZoneId: string;
  /** "#RRGGBB" (OrganizationPalette), the colour personal analytics already uses. */
  color: string;
  /** The viewer's role; null in hub payloads (and when unknown). */
  myRole: OrgRole | null;
  /** Join codes and expiries are non-null only for Owner/Admin (Q8). */
  memberJoinCode: string | null;
  memberJoinCodeExpiryUtc: UtcIsoString | null;
  adminJoinCode: string | null;
  adminJoinCodeExpiryUtc: UtcIsoString | null;
}

export interface Membership {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  userEmail: string;
  /** Display name, falling back to the email. */
  displayName: string;
  role: OrgRole;
  status: MembershipStatus;
  statusMessage: string | null;
}

export interface SelectableMember {
  userId: string;
  userEmail: string;
  displayName: string;
}

export interface JoinCodes {
  organizationId: string;
  memberJoinCode: string;
  memberJoinCodeExpiryUtc: UtcIsoString;
  adminJoinCode: string;
  adminJoinCodeExpiryUtc: UtcIsoString;
}

export interface Invitation {
  id: string;
  organizationId: string;
  organizationName: string;
  invitedUserEmail: string;
  role: AssignableRole;
  status: InvitationStatus;
  expiryUtc: UtcIsoString;
  invitedByDisplayName: string | null;
  createdOnUtc: UtcIsoString | null;
}

/** What an invitation link shows (anonymous; the token is the secret). */
export interface InvitationPreview {
  organizationId: string;
  organizationName: string;
  role: AssignableRole;
  invitedByDisplayName: string | null;
  /** "m•••@gmail.com" */
  invitedEmailMasked: string;
  /** A pending invitation past its expiry reads "Expired". */
  status: InvitationStatus;
  expiryUtc: UtcIsoString;
  /** null when signed out. */
  matchesCurrentUser: boolean | null;
}

export interface Issue {
  id: string;
  title: string;
  notes: string | null;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  organizationId: string;
  issuePanelId: string;
  /** Set once the issue was promoted to a task. */
  convertedToTaskId: string | null;
  createdOnUtc: UtcIsoString | null;
}

export interface IssuePanel {
  id: string;
  name: string;
  organizationId: string;
}

export interface IssueBoardPanel {
  id: string;
  name: string;
  issues: Issue[];
}

/** Panels ordered by creation then name; issues by creation then id (server order). */
export interface IssueBoard {
  organizationId: string;
  organizationName: string;
  panels: IssueBoardPanel[];
}

export interface OrgTimePerCategory {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  totalHours: number;
}

export interface OrgTimePerMember {
  memberId: string;
  displayName: string;
  memberEmail: string;
  memberStatus: MembershipStatus;
  totalHours: number;
}

export interface OrgBreakdownPoint {
  key: string;
  label: string;
  value: number;
  dominantCategoryColor: string;
}

interface OrgAnalyticsBase {
  organizationId: string;
  timeZoneId: string;
  /** "America/New_York (UTC-04:00/-05:00)" (server ReportFormatting.ZoneLabel). */
  timeZoneLabel: string;
  view: AnalyticsView;
  /** Half-open range resolved in the ORG zone. */
  rangeStartUtc: UtcIsoString;
  rangeEndUtc: UtcIsoString;
  /** Σ durations, each task counted once. */
  totalHours: number;
  taskCount: number;
  timePerCategory: OrgTimePerCategory[];
  /** Zero-filled: every bucket of the selection, in order. */
  breakdownData: OrgBreakdownPoint[];
}

export interface OrgAnalytics extends OrgAnalyticsBase {
  /** Σ per assignment (person-hours) = Σ timePerMember. */
  assignedHours: number;
  /** Hours desc, then name, then id; includes former members. */
  timePerMember: OrgTimePerMember[];
}

export interface MemberAnalytics extends OrgAnalyticsBase {
  memberId: string;
  displayName: string;
  memberEmail: string;
  memberStatus: MembershipStatus;
}

export type ActivityActionType = "Created" | "Updated" | "Joined" | "Left" | "Removed" | "Exported";
export type ActivityEntityType = "Organization" | "Task" | "Issue" | "Member" | "Report";

export interface ActivityItem {
  /** Stable id, e.g. "task:{id}:created". */
  id: string;
  timestamp: UtcIsoString;
  actorUserId: string | null;
  actorDisplayName: string | null;
  actorUserEmail: string | null;
  actionType: ActivityActionType;
  entityType: ActivityEntityType;
  entityId: string | null;
  /** English fallback text. */
  description: string;
}

export interface ActivityPage {
  items: ActivityItem[];
  /** Pass as `before` for the next page; null at the end of the feed. */
  nextBefore: UtcIsoString | null;
}

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
}

// --- Request bodies (the services add the route ids the server wants in the body) ---

export interface CreateOrganizationInput {
  name: string;
  /** Omitted → the server uses the creator's zone (X-Time-Zone). */
  timeZoneId?: string;
}

export interface UpdateOrganizationInput {
  name: string;
  timeZoneId?: string;
}

export interface InviteInput {
  email: string;
  role: AssignableRole;
}

export interface OrgTaskInput {
  title: string;
  start: UtcIsoString;
  duration: number;
  /** One of the creator's own categories. */
  categoryId: string;
}

export interface OrgTaskWithAssigneesInput extends OrgTaskInput {
  /** ≥ 1 (the server de-duplicates). */
  assigneeIds: string[];
}

export interface IssueInput {
  title: string;
  notes?: string | null;
  categoryId: string;
}

export interface PromoteIssueInput {
  start: UtcIsoString;
  duration: number;
  assigneeIds: string[];
}

export interface ActivityQuery {
  /** Exclusive; default now. */
  before?: UtcIsoString | null;
  /** 1–100 (default 50). */
  limit?: number;
}
