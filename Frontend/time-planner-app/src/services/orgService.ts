// src/services/orgService.ts — typed wrappers for every organization endpoint
// (docs/plans/organizations-phase3.md §2). One function per endpoint; responses are normalized at
// this boundary: instants become canonical UTC strings with Z (normalizeApiInstant), tasks go
// through normalizeTask, and analytics queries send the selection (reportSelection) so the server
// resolves the range in the ORGANIZATION's zone (never computed with datetime.ts).
//
// Errors are thrown as they come from axios (apiErrors.ts turns them into copy). Callers that keep
// state wrap these calls in sessionBound().

import apiService from "./apiService";
import { normalizeTask } from "./apiDataService";
import type { Task } from "@/types";
import type {
  ActivityItem,
  ActivityPage,
  ActivityQuery,
  AssignableRole,
  CreateOrganizationInput,
  Invitation,
  InvitationPreview,
  InvitationStatus,
  InviteInput,
  Issue,
  IssueBoard,
  IssueInput,
  IssuePanel,
  JoinCodes,
  MemberAnalytics,
  Membership,
  MembershipStatus,
  OrgAnalytics,
  OrgRole,
  OrgTaskInput,
  OrgTaskWithAssigneesInput,
  Organization,
  PromoteIssueInput,
  SelectableMember,
  UpdateOrganizationInput,
} from "@/types/org";
import { isInRange, normalizeApiInstant, toApiInstant, type InstantRange, type UtcIsoString } from "@/lib/datetime";
import { reportSelection } from "@/lib/reportQuery";
import type { AnalyticsSelection } from "@/lib/analyticsBuckets";
import { OTHER_COLOR } from "@/lib/categoryPalette";
import { normalizeJoinCode } from "@/lib/joinCode";

// ---------------------------------------------------------------------------------------------
// Normalization (tolerant of the pre-3A shapes: no `myRole`/`color`, codes "hidden")
// ---------------------------------------------------------------------------------------------

type Raw = Record<string, unknown>;

const ROLES: readonly OrgRole[] = ["Owner", "Admin", "Member"];
const STATUSES: readonly MembershipStatus[] = ["Active", "Left", "Removed"];
const INVITATION_STATUSES: readonly InvitationStatus[] = ["Pending", "Accepted", "Declined", "Rescinded", "Expired"];

function str(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function optStr(value: unknown): string | null {
  const s = str(value).trim();
  return s ? s : null;
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function toRole(value: unknown): OrgRole | null {
  const s = str(value);
  return ROLES.find((r) => r.toLowerCase() === s.toLowerCase()) ?? null;
}

function toAssignableRole(value: unknown): AssignableRole {
  return toRole(value) === "Admin" ? "Admin" : "Member";
}

function toStatus(value: unknown): MembershipStatus {
  const s = str(value);
  return STATUSES.find((r) => r.toLowerCase() === s.toLowerCase()) ?? "Active";
}

function toInvitationStatus(value: unknown): InvitationStatus {
  const s = str(value);
  return INVITATION_STATUSES.find((r) => r.toLowerCase() === s.toLowerCase()) ?? "Pending";
}

/** A canonical instant, or null for missing/unparseable values. */
function instantOrNull(value: unknown): UtcIsoString | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return normalizeApiInstant(value);
  } catch {
    return null;
  }
}

function instant(value: unknown): UtcIsoString {
  return instantOrNull(value) ?? normalizeApiInstant("1970-01-01T00:00:00Z");
}

/** A join code the viewer may see, or null ("hidden" / empty mean "not for you"). */
function visibleCode(value: unknown): string | null {
  const code = optStr(value);
  return code && code.toLowerCase() !== "hidden" ? code : null;
}

export function normalizeOrganization(raw: unknown): Organization {
  const o = (raw ?? {}) as Raw;
  const memberJoinCode = visibleCode(o.memberJoinCode);
  const adminJoinCode = visibleCode(o.adminJoinCode);
  return {
    id: str(o.id),
    name: str(o.name),
    ownerId: str(o.ownerId),
    timeZoneId: optStr(o.timeZoneId) ?? "UTC",
    color: optStr(o.color) ?? OTHER_COLOR,
    myRole: toRole(o.myRole),
    memberJoinCode,
    memberJoinCodeExpiryUtc: memberJoinCode ? instantOrNull(o.memberJoinCodeExpiryUtc) : null,
    adminJoinCode,
    adminJoinCodeExpiryUtc: adminJoinCode ? instantOrNull(o.adminJoinCodeExpiryUtc) : null,
  };
}

export function normalizeMembership(raw: unknown): Membership {
  const m = (raw ?? {}) as Raw;
  const email = str(m.userEmail);
  return {
    membershipId: str(m.membershipId),
    organizationId: str(m.organizationId),
    organizationName: str(m.organizationName),
    userId: str(m.userId),
    userEmail: email,
    displayName: optStr(m.displayName) ?? email,
    role: toRole(m.role) ?? "Member",
    status: toStatus(m.status),
    statusMessage: optStr(m.statusMessage),
  };
}

function normalizeSelectable(raw: unknown): SelectableMember {
  const m = (raw ?? {}) as Raw;
  const email = str(m.userEmail);
  return { userId: str(m.userId), userEmail: email, displayName: optStr(m.displayName) ?? email };
}

function normalizeJoinCodes(raw: unknown): JoinCodes {
  const c = (raw ?? {}) as Raw;
  return {
    organizationId: str(c.organizationId),
    memberJoinCode: str(c.memberJoinCode),
    memberJoinCodeExpiryUtc: instant(c.memberJoinCodeExpiryUtc),
    adminJoinCode: str(c.adminJoinCode),
    adminJoinCodeExpiryUtc: instant(c.adminJoinCodeExpiryUtc),
  };
}

export function normalizeInvitation(raw: unknown): Invitation {
  const i = (raw ?? {}) as Raw;
  return {
    id: str(i.id),
    organizationId: str(i.organizationId),
    organizationName: str(i.organizationName),
    invitedUserEmail: str(i.invitedUserEmail),
    role: toAssignableRole(i.role),
    status: toInvitationStatus(i.status),
    expiryUtc: instant(i.expiryUtc),
    invitedByDisplayName: optStr(i.invitedByDisplayName),
    createdOnUtc: instantOrNull(i.createdOnUtc),
  };
}

function normalizePreview(raw: unknown): InvitationPreview {
  const p = (raw ?? {}) as Raw;
  return {
    organizationId: str(p.organizationId),
    organizationName: str(p.organizationName),
    role: toAssignableRole(p.role),
    invitedByDisplayName: optStr(p.invitedByDisplayName),
    invitedEmailMasked: str(p.invitedEmailMasked),
    status: toInvitationStatus(p.status),
    expiryUtc: instant(p.expiryUtc),
    matchesCurrentUser: typeof p.matchesCurrentUser === "boolean" ? p.matchesCurrentUser : null,
  };
}

export function normalizeIssue(raw: unknown): Issue {
  const i = (raw ?? {}) as Raw;
  return {
    id: str(i.id),
    title: str(i.title),
    notes: optStr(i.notes),
    categoryId: str(i.categoryId),
    categoryName: str(i.categoryName),
    categoryColor: optStr(i.categoryColor) ?? OTHER_COLOR,
    organizationId: str(i.organizationId),
    issuePanelId: str(i.issuePanelId),
    convertedToTaskId: optStr(i.convertedToTaskId),
    createdOnUtc: instantOrNull(i.createdOnUtc),
  };
}

function normalizePanel(raw: unknown): IssuePanel {
  const p = (raw ?? {}) as Raw;
  return { id: str(p.id), name: str(p.name), organizationId: str(p.organizationId) };
}

function normalizeBoard(raw: unknown): IssueBoard {
  const b = (raw ?? {}) as Raw;
  const panels = Array.isArray(b.panels) ? b.panels : [];
  return {
    organizationId: str(b.organizationId),
    organizationName: str(b.organizationName),
    panels: panels.map((p) => {
      const panel = (p ?? {}) as Raw;
      return {
        id: str(panel.id),
        name: str(panel.name),
        issues: (Array.isArray(panel.issues) ? panel.issues : []).map(normalizeIssue),
      };
    }),
  };
}

function normalizeAnalyticsBase(a: Raw) {
  const view = str(a.view);
  return {
    organizationId: str(a.organizationId),
    timeZoneId: optStr(a.timeZoneId) ?? "UTC",
    timeZoneLabel: str(a.timeZoneLabel),
    view: (view === "weekly" || view === "daily" ? view : "monthly") as OrgAnalytics["view"],
    rangeStartUtc: instant(a.rangeStartUtc),
    rangeEndUtc: instant(a.rangeEndUtc),
    totalHours: num(a.totalHours),
    taskCount: num(a.taskCount),
    timePerCategory: (Array.isArray(a.timePerCategory) ? a.timePerCategory : []).map((c) => {
      const r = (c ?? {}) as Raw;
      return {
        categoryId: str(r.categoryId),
        categoryName: str(r.categoryName),
        categoryColor: optStr(r.categoryColor) ?? OTHER_COLOR,
        totalHours: num(r.totalHours),
      };
    }),
    breakdownData: (Array.isArray(a.breakdownData) ? a.breakdownData : []).map((d) => {
      const r = (d ?? {}) as Raw;
      return {
        key: str(r.key),
        label: str(r.label),
        value: num(r.value),
        dominantCategoryColor: optStr(r.dominantCategoryColor) ?? OTHER_COLOR,
      };
    }),
  };
}

function normalizeOrgAnalytics(raw: unknown): OrgAnalytics {
  const a = (raw ?? {}) as Raw;
  return {
    ...normalizeAnalyticsBase(a),
    assignedHours: num(a.assignedHours),
    timePerMember: (Array.isArray(a.timePerMember) ? a.timePerMember : []).map((m) => {
      const r = (m ?? {}) as Raw;
      const email = str(r.memberEmail);
      return {
        memberId: str(r.memberId),
        displayName: optStr(r.displayName) ?? email,
        memberEmail: email,
        memberStatus: toStatus(r.memberStatus),
        totalHours: num(r.totalHours),
      };
    }),
  };
}

function normalizeMemberAnalytics(raw: unknown): MemberAnalytics {
  const a = (raw ?? {}) as Raw;
  const email = str(a.memberEmail);
  return {
    ...normalizeAnalyticsBase(a),
    memberId: str(a.memberId),
    displayName: optStr(a.displayName) ?? email,
    memberEmail: email,
    memberStatus: toStatus(a.memberStatus),
  };
}

function normalizeActivityItem(raw: unknown): ActivityItem | null {
  const i = (raw ?? {}) as Raw;
  const timestamp = instantOrNull(i.timestamp);
  if (!timestamp) return null;
  return {
    id: str(i.id),
    timestamp,
    actorUserId: optStr(i.actorUserId),
    actorDisplayName: optStr(i.actorDisplayName),
    actorUserEmail: optStr(i.actorUserEmail),
    actionType: str(i.actionType) as ActivityItem["actionType"],
    entityType: str(i.entityType) as ActivityItem["entityType"],
    entityId: optStr(i.entityId),
    description: str(i.description),
  };
}

function normalizeActivityPage(raw: unknown): ActivityPage {
  const p = (raw ?? {}) as Raw;
  const items = (Array.isArray(p.items) ? p.items : []).map(normalizeActivityItem);
  return {
    items: items.filter((i): i is ActivityItem => i !== null),
    nextBefore: instantOrNull(p.nextBefore),
  };
}

function requireTask(raw: unknown): Task {
  const task = normalizeTask(raw as Task);
  if (!task) throw new Error("The server returned a task with an invalid start.");
  return task;
}

function tasksOf(raw: unknown): Task[] {
  return (Array.isArray(raw) ? raw : [])
    .map((t) => normalizeTask(t as Task))
    .filter((t): t is Task => t !== null);
}

const enc = encodeURIComponent;
const orgPath = (orgId: string) => `/organizations/${enc(orgId)}`;

// ---------------------------------------------------------------------------------------------
// §2.2 Organizations, codes
// ---------------------------------------------------------------------------------------------

async function createOrganization(input: CreateOrganizationInput): Promise<Organization> {
  const body: CreateOrganizationInput = { name: input.name.trim() };
  if (input.timeZoneId) body.timeZoneId = input.timeZoneId;
  const response = await apiService.post("/organizations", body);
  return normalizeOrganization(response.data);
}

async function getOrganization(orgId: string): Promise<Organization> {
  const response = await apiService.get(orgPath(orgId));
  return normalizeOrganization(response.data);
}

async function getMyOrganizations(): Promise<Organization[]> {
  const response = await apiService.get("/users/me/organizations");
  return (Array.isArray(response.data) ? response.data : []).map(normalizeOrganization);
}

async function updateOrganization(orgId: string, input: UpdateOrganizationInput): Promise<void> {
  await apiService.put(orgPath(orgId), { organizationId: orgId, name: input.name.trim(), timeZoneId: input.timeZoneId });
}

async function deleteOrganization(orgId: string): Promise<void> {
  await apiService.delete(orgPath(orgId));
}

/** Join with an 8-character code (normalized: upper case, spaces and dashes removed). */
async function joinOrganization(code: string): Promise<Membership> {
  const response = await apiService.post("/organizations/join", { joinCode: normalizeJoinCode(code) });
  return normalizeMembership(response.data);
}

async function getJoinCodes(orgId: string): Promise<JoinCodes> {
  const response = await apiService.get(`${orgPath(orgId)}/join-codes`);
  return normalizeJoinCodes(response.data);
}

async function regenerateJoinCodes(orgId: string, expiryDays: number): Promise<Organization> {
  const response = await apiService.post(`${orgPath(orgId)}/regenerate-codes`, { organizationId: orgId, expiryDays });
  return normalizeOrganization(response.data);
}

// ---------------------------------------------------------------------------------------------
// §2.3 Members
// ---------------------------------------------------------------------------------------------

/** O/A get every status; members get Active members only. */
async function getMembers(orgId: string): Promise<Membership[]> {
  const response = await apiService.get(`${orgPath(orgId)}/members`);
  return (Array.isArray(response.data) ? response.data : []).map(normalizeMembership);
}

/** My membership; 404 unless Active (after 3A). */
async function getMyMembership(orgId: string): Promise<Membership> {
  const response = await apiService.get(`${orgPath(orgId)}/members/me`);
  return normalizeMembership(response.data);
}

/** Active members an admin can assign tasks to (O/A). */
async function getSelectableMembers(orgId: string): Promise<SelectableMember[]> {
  const response = await apiService.get(`${orgPath(orgId)}/members/selectable`);
  return (Array.isArray(response.data) ? response.data : []).map(normalizeSelectable);
}

async function updateMemberRole(orgId: string, userId: string, newRole: AssignableRole): Promise<void> {
  await apiService.put(`${orgPath(orgId)}/members/${enc(userId)}/role`, { organizationId: orgId, userId, newRole });
}

async function removeMember(orgId: string, userId: string, options: { hardDeleteTasks?: boolean } = {}): Promise<void> {
  await apiService.delete(`${orgPath(orgId)}/members/${enc(userId)}`, {
    params: { hardDeleteTasks: options.hardDeleteTasks === true },
  });
}

async function leaveOrganization(orgId: string): Promise<void> {
  await apiService.post(`${orgPath(orgId)}/members/me/leave`);
}

/** My status message in the org (≤ 150 characters; null/empty clears it). */
async function updateMySettings(orgId: string, statusMessage: string | null): Promise<void> {
  const message = statusMessage?.trim() || null;
  await apiService.put(`${orgPath(orgId)}/members/me/settings`, { organizationId: orgId, statusMessage: message });
}

/** The target must be an active Admin. */
async function transferOwnership(orgId: string, newOwnerUserId: string): Promise<void> {
  await apiService.post(`${orgPath(orgId)}/transfer-ownership`, { organizationId: orgId, newOwnerUserId });
}

// ---------------------------------------------------------------------------------------------
// §2.4 Invitations
// ---------------------------------------------------------------------------------------------

async function inviteMember(orgId: string, input: InviteInput): Promise<Invitation> {
  const response = await apiService.post(`${orgPath(orgId)}/invitations`, {
    organizationId: orgId,
    email: input.email.trim(),
    role: input.role,
  });
  return normalizeInvitation(response.data);
}

/** Pending, unexpired invitations of the org, newest first (O/A). */
async function getOrganizationInvitations(orgId: string): Promise<Invitation[]> {
  const response = await apiService.get(`${orgPath(orgId)}/invitations`);
  return (Array.isArray(response.data) ? response.data : []).map(normalizeInvitation);
}

async function rescindInvitation(orgId: string, inviteId: string): Promise<void> {
  await apiService.delete(`${orgPath(orgId)}/invitations/${enc(inviteId)}`);
}

/** My inbox: pending, unexpired invitations to my email. */
async function getMyInvitations(): Promise<Invitation[]> {
  const response = await apiService.get("/users/me/invitations");
  return (Array.isArray(response.data) ? response.data : []).map(normalizeInvitation);
}

async function getInvitation(inviteId: string): Promise<Invitation> {
  const response = await apiService.get(`/invitations/${enc(inviteId)}`);
  return normalizeInvitation(response.data);
}

/** What an invitation link shows. Anonymous (the token is the secret); signed in it also says whether it is for me. */
async function getInvitationPreview(token: string): Promise<InvitationPreview> {
  const response = await apiService.get(`/invitations/${enc(token)}`);
  return normalizePreview(response.data);
}

async function acceptInvitationByToken(token: string): Promise<Membership> {
  const response = await apiService.post(`/invitations/${enc(token)}/accept`);
  return normalizeMembership(response.data);
}

/** Anonymous decline from the email link (§8 Q-F). */
async function declineInvitationByToken(token: string): Promise<void> {
  await apiService.post(`/invitations/${enc(token)}/decline`);
}

async function acceptInvitationById(inviteId: string): Promise<Membership> {
  const response = await apiService.post(`/invitations/${enc(inviteId)}/accept`);
  return normalizeMembership(response.data);
}

async function declineInvitationById(inviteId: string): Promise<void> {
  await apiService.post(`/invitations/${enc(inviteId)}/decline`);
}

// ---------------------------------------------------------------------------------------------
// §2.5 Org tasks (schedule) — ranges are the VIEWER's (weekRange from datetime.ts, D5)
// ---------------------------------------------------------------------------------------------

function taskBody(orgId: string, input: OrgTaskInput) {
  return {
    organizationId: orgId,
    title: input.title,
    start: toApiInstant(input.start),
    duration: input.duration,
    categoryId: input.categoryId,
  };
}

/**
 * Org tasks starting in `[range.start, range.end)`, by start, with capabilities. Members only get
 * their own assignments (Q6). Filtered client-side too, like the personal week.
 */
async function getOrganizationTasks(orgId: string, range: InstantRange, memberId?: string | null): Promise<Task[]> {
  const params: Record<string, string> = { startDate: range.start, endDate: range.end };
  if (memberId) params.memberId = memberId;
  const response = await apiService.get(`${orgPath(orgId)}/tasks`, { params });
  return tasksOf(response.data).filter((task) => isInRange(task.start, range));
}

async function getOrganizationTask(orgId: string, taskId: string): Promise<Task> {
  const response = await apiService.get(`${orgPath(orgId)}/tasks/${enc(taskId)}`);
  return requireTask(response.data);
}

/** A task for others (O/A). */
async function createOrganizationTask(orgId: string, input: OrgTaskWithAssigneesInput): Promise<Task> {
  const response = await apiService.post(`${orgPath(orgId)}/tasks`, {
    ...taskBody(orgId, input),
    assigneeIds: [...new Set(input.assigneeIds)],
  });
  return requireTask(response.data);
}

/** A task assigned to me (any role). */
async function createOwnOrganizationTask(orgId: string, input: OrgTaskInput): Promise<Task> {
  const response = await apiService.post(`${orgPath(orgId)}/tasks/personal`, taskBody(orgId, input));
  return requireTask(response.data);
}

async function updateOrganizationTask(orgId: string, taskId: string, input: OrgTaskInput): Promise<void> {
  await apiService.put(`${orgPath(orgId)}/tasks/${enc(taskId)}`, { ...taskBody(orgId, input), taskId });
}

async function setTaskAssignees(orgId: string, taskId: string, assigneeIds: string[]): Promise<void> {
  await apiService.put(`${orgPath(orgId)}/tasks/${enc(taskId)}/assignees`, {
    organizationId: orgId,
    taskId,
    newAssigneeIds: [...new Set(assigneeIds)],
  });
}

async function deleteOrganizationTask(orgId: string, taskId: string): Promise<void> {
  await apiService.delete(`${orgPath(orgId)}/tasks/${enc(taskId)}`);
}

// ---------------------------------------------------------------------------------------------
// §2.6 Board
// ---------------------------------------------------------------------------------------------

async function getIssueBoard(orgId: string, options: { includeScheduled?: boolean } = {}): Promise<IssueBoard> {
  const response = await apiService.get(`${orgPath(orgId)}/issue-board`, {
    params: { includeScheduled: options.includeScheduled === true },
  });
  return normalizeBoard(response.data);
}

async function createPanel(orgId: string, name: string): Promise<IssuePanel> {
  const response = await apiService.post(`${orgPath(orgId)}/issue-panels`, { organizationId: orgId, name: name.trim() });
  return normalizePanel(response.data);
}

async function renamePanel(orgId: string, panelId: string, name: string): Promise<void> {
  await apiService.put(`${orgPath(orgId)}/issue-panels/${enc(panelId)}`, { organizationId: orgId, panelId, name: name.trim() });
}

/** Deletes the panel and its issues. */
async function deletePanel(orgId: string, panelId: string): Promise<void> {
  await apiService.delete(`${orgPath(orgId)}/issue-panels/${enc(panelId)}`);
}

function issueBody(orgId: string, panelId: string, input: IssueInput) {
  return {
    organizationId: orgId,
    panelId,
    title: input.title,
    notes: input.notes?.trim() || null,
    categoryId: input.categoryId,
  };
}

async function createIssue(orgId: string, panelId: string, input: IssueInput): Promise<Issue> {
  const response = await apiService.post(`${orgPath(orgId)}/issue-panels/${enc(panelId)}/issues`, issueBody(orgId, panelId, input));
  return normalizeIssue(response.data);
}

async function updateIssue(orgId: string, panelId: string, issueId: string, input: IssueInput): Promise<void> {
  await apiService.put(`${orgPath(orgId)}/issue-panels/${enc(panelId)}/issues/${enc(issueId)}`, {
    ...issueBody(orgId, panelId, input),
    issueId,
  });
}

async function deleteIssue(orgId: string, panelId: string, issueId: string): Promise<void> {
  await apiService.delete(`${orgPath(orgId)}/issue-panels/${enc(panelId)}/issues/${enc(issueId)}`);
}

async function moveIssue(orgId: string, issueId: string, newPanelId: string): Promise<void> {
  await apiService.put(`${orgPath(orgId)}/issues/${enc(issueId)}/move`, { organizationId: orgId, issueId, newPanelId });
}

async function promoteIssue(orgId: string, issueId: string, input: PromoteIssueInput): Promise<Task> {
  const response = await apiService.post(`${orgPath(orgId)}/issues/${enc(issueId)}/promote-to-task`, {
    organizationId: orgId,
    issueId,
    start: toApiInstant(input.start),
    duration: input.duration,
    assigneeIds: [...new Set(input.assigneeIds)],
  });
  return requireTask(response.data);
}

// ---------------------------------------------------------------------------------------------
// §2.7 Analytics (selection contract; bucketed in the ORG zone, X-Time-Zone is ignored)
// ---------------------------------------------------------------------------------------------

async function getOrganizationAnalytics(orgId: string, selection: AnalyticsSelection): Promise<OrgAnalytics> {
  const response = await apiService.get(`${orgPath(orgId)}/analytics`, { params: reportSelection(selection) });
  return normalizeOrgAnalytics(response.data);
}

async function getMemberAnalytics(orgId: string, memberId: string, selection: AnalyticsSelection): Promise<MemberAnalytics> {
  const response = await apiService.get(`${orgPath(orgId)}/analytics/members/${enc(memberId)}`, {
    params: reportSelection(selection),
  });
  return normalizeMemberAnalytics(response.data);
}

/** Calendar years (org zone) with org tasks, newest first (members: their own). */
async function getAnalyticsYears(orgId: string): Promise<number[]> {
  const response = await apiService.get(`${orgPath(orgId)}/analytics/years`);
  return (Array.isArray(response.data) ? response.data : [])
    .map((y) => Number(y))
    .filter((y) => Number.isInteger(y));
}

// ---------------------------------------------------------------------------------------------
// §2.8 Activity
// ---------------------------------------------------------------------------------------------

async function getActivity(orgId: string, query: ActivityQuery = {}): Promise<ActivityPage> {
  const params: Record<string, string | number> = { limit: query.limit ?? 50 };
  if (query.before) params.before = toApiInstant(query.before);
  const response = await apiService.get(`${orgPath(orgId)}/activity`, { params });
  return normalizeActivityPage(response.data);
}

export const orgService = {
  // organizations, codes
  createOrganization,
  getOrganization,
  getMyOrganizations,
  updateOrganization,
  deleteOrganization,
  joinOrganization,
  getJoinCodes,
  regenerateJoinCodes,
  // members
  getMembers,
  getMyMembership,
  getSelectableMembers,
  updateMemberRole,
  removeMember,
  leaveOrganization,
  updateMySettings,
  transferOwnership,
  // invitations
  inviteMember,
  getOrganizationInvitations,
  rescindInvitation,
  getMyInvitations,
  getInvitation,
  getInvitationPreview,
  acceptInvitationByToken,
  declineInvitationByToken,
  acceptInvitationById,
  declineInvitationById,
  // tasks
  getOrganizationTasks,
  getOrganizationTask,
  createOrganizationTask,
  createOwnOrganizationTask,
  updateOrganizationTask,
  setTaskAssignees,
  deleteOrganizationTask,
  // board
  getIssueBoard,
  createPanel,
  renamePanel,
  deletePanel,
  createIssue,
  updateIssue,
  deleteIssue,
  moveIssue,
  promoteIssue,
  // analytics
  getOrganizationAnalytics,
  getMemberAnalytics,
  getAnalyticsYears,
  // activity
  getActivity,
};

export type OrgService = typeof orgService;
