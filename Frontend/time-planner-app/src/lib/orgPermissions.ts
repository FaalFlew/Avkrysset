// src/lib/orgPermissions.ts — what a role may do in an organization (the permission matrix,
// docs/plans/organizations-phase3.md §6). The API is the authority; this mirrors it so the UI can
// hide what a role can never do and disable (with a reason) what is only circumstantial.
//
//   can(role, action, ctx?) → { allowed: true }
//                           | { allowed: false; hidden: true;  reason }   the role can never do it: hide the control
//                           | { allowed: false; hidden: false; reason }   not now (e.g. the owner leaving): disable + say why
//
// `role` is the viewer's role in the org (null = not an active member: everything is hidden).
// `taskCapabilitiesFor` is the server's TaskCapabilities.For, for tasks that arrive without
// capabilities (hub payloads).

import type { Task, TaskCapabilities } from "@/types";
import type { AssignableRole, MembershipStatus, OrgRole } from "@/types/org";

export type OrgAction =
  /** View the org, board, activity and the members directory (members: Active members only). */
  | "org.view"
  /** Edit the name and time zone. */
  | "org.edit"
  | "org.delete"
  /** ctx: `target` (must be an active Admin) or `activeAdminCount`. */
  | "org.transferOwnership"
  | "org.regenerateCodes"
  /** View/copy join codes (Q8: admins too). */
  | "org.viewCodes"
  /** The owner must transfer ownership first. */
  | "org.leave"
  /** Invite, list and rescind invitations. */
  | "invitations.manage"
  /** ctx: `target`, `newRole`. */
  | "member.changeRole"
  /** ctx: `target`. Only the owner may remove an admin (§8 Q-E). */
  | "member.remove"
  /** My own status message. */
  | "member.editOwnStatus"
  /** Every member's schedule + the member filter (members see their own tasks only, Q6). */
  | "schedule.viewAll"
  | "task.createForOthers"
  /** A task assigned to me (`/tasks/personal`). */
  | "task.createOwn"
  /** ctx: `task`, `meId` (= TaskCapabilities.For). */
  | "task.edit"
  /** ctx: `task`, `meId`. */
  | "task.delete"
  | "task.reassign"
  /** Panels (create/rename/delete) and issues (create/edit/delete/move/promote). */
  | "board.manage"
  /** Org analytics and any member's analytics. */
  | "analytics.viewOrg"
  /** ctx: `memberId`, `meId`. O/A: anyone; members: themselves. */
  | "analytics.viewMember"
  /** Task items of every member in the activity feed (members: tasks assigned to them, §8 Q-A). */
  | "activity.viewAllTasks";

/** A member a role action targets. */
export interface TargetMember {
  userId?: string;
  role: OrgRole;
  /** Absent = Active. */
  status?: MembershipStatus;
}

/** The task fields the capability rule reads. */
export type TaskForCapabilities = Pick<Task, "organizationId" | "createdBy">;

export interface PermissionContext {
  target?: TargetMember;
  newRole?: AssignableRole;
  /** Active admins in the org (transfer-ownership availability without a specific target). */
  activeAdminCount?: number;
  task?: TaskForCapabilities;
  meId?: string | null;
  memberId?: string | null;
}

export type Permission = { allowed: true } | { allowed: false; hidden: boolean; reason: string };

const ALLOWED: Permission = { allowed: true };
const hidden = (reason: string): Permission => ({ allowed: false, hidden: true, reason });
const disabled = (reason: string): Permission => ({ allowed: false, hidden: false, reason });

export const NOT_A_MEMBER = "You're not a member of this organization.";
const ADMINS_ONLY = "Only the owner and admins can do that.";
const OWNER_ONLY = "Only the owner can do that.";

const isAdminOrOwner = (role: OrgRole) => role === "Owner" || role === "Admin";
const isActive = (target: TargetMember) => (target.status ?? "Active") === "Active";
const sameId = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

const READ_ONLY: TaskCapabilities = { canEdit: false, canDelete: false, canReassign: false };

/**
 * What `role` may do with `task` when the server sent no capabilities — exactly the server's
 * TaskCapabilities.For: personal tasks are fully editable (never reassignable); Owner/Admin may do
 * everything with org tasks; a Member may edit/delete the org tasks they created; nothing else.
 */
export function taskCapabilitiesFor(
  role: OrgRole | null,
  task: TaskForCapabilities,
  meId: string | null | undefined
): TaskCapabilities {
  if (!task.organizationId) return { canEdit: true, canDelete: true, canReassign: false };
  if (role === "Owner" || role === "Admin") return { canEdit: true, canDelete: true, canReassign: true };
  if (role === "Member" && sameId(task.createdBy?.userId, meId)) return { canEdit: true, canDelete: true, canReassign: false };
  return { ...READ_ONLY };
}

/** Whether `role` may do `action` (§6). See the module comment for the result shape. */
export function can(role: OrgRole | null | undefined, action: OrgAction, ctx: PermissionContext = {}): Permission {
  if (!role) return hidden(NOT_A_MEMBER);
  const admin = isAdminOrOwner(role);

  switch (action) {
    case "org.view":
    case "member.editOwnStatus":
    case "task.createOwn":
      return ALLOWED;

    case "org.edit":
    case "org.viewCodes":
    case "invitations.manage":
    case "schedule.viewAll":
    case "task.createForOthers":
    case "task.reassign":
    case "board.manage":
    case "analytics.viewOrg":
    case "activity.viewAllTasks":
      return admin ? ALLOWED : hidden(ADMINS_ONLY);

    case "org.delete":
    case "org.regenerateCodes":
      return role === "Owner" ? ALLOWED : hidden(OWNER_ONLY);

    case "org.transferOwnership": {
      if (role !== "Owner") return hidden("Only the owner can transfer ownership.");
      const { target } = ctx;
      if (target) {
        if (!isActive(target)) return hidden("They're no longer a member.");
        if (target.role === "Owner") return hidden("They already own this organization.");
        if (target.role !== "Admin") return disabled("Only an admin can become the owner. Make them an admin first.");
        return ALLOWED;
      }
      if (ctx.activeAdminCount !== undefined && ctx.activeAdminCount < 1) return disabled("Make someone an admin first.");
      return ALLOWED;
    }

    case "org.leave":
      return role === "Owner" ? disabled("Transfer ownership first.") : ALLOWED;

    case "member.changeRole": {
      if (!admin) return hidden(ADMINS_ONLY);
      const { target, newRole } = ctx;
      if (!target) return ALLOWED;
      if (!isActive(target)) return hidden("They're no longer a member.");
      if (target.role === "Owner") return hidden("The owner's role can't be changed.");
      if (newRole && newRole === target.role) return hidden(`They're already ${newRole === "Admin" ? "an admin" : "a member"}.`);
      // Admins may promote; only the owner may demote an admin.
      if (role === "Admin" && target.role === "Admin") return disabled("Only the owner can change an admin's role.");
      return ALLOWED;
    }

    case "member.remove": {
      if (!admin) return hidden(ADMINS_ONLY);
      const { target } = ctx;
      if (!target) return ALLOWED;
      if (!isActive(target)) return hidden("They're no longer a member.");
      if (target.role === "Owner") return hidden("The owner can't be removed.");
      if (role === "Admin" && target.role === "Admin") return disabled("Only the owner can remove an admin.");
      return ALLOWED;
    }

    case "task.edit":
    case "task.delete": {
      if (!ctx.task) return admin ? ALLOWED : hidden("Only the owner, admins and the task's creator can change it.");
      const caps = taskCapabilitiesFor(role, ctx.task, ctx.meId);
      const ok = action === "task.edit" ? caps.canEdit : caps.canDelete;
      return ok ? ALLOWED : hidden("Only the owner, admins and the task's creator can change it.");
    }

    case "analytics.viewMember":
      if (admin) return ALLOWED;
      if (!ctx.memberId || sameId(ctx.memberId, ctx.meId)) return ALLOWED;
      return hidden("Members can only see their own analytics.");
  }
}

/** Convenience: `can(...).allowed`. */
export function isAllowed(role: OrgRole | null | undefined, action: OrgAction, ctx?: PermissionContext): boolean {
  return can(role, action, ctx).allowed;
}

/** Whether a control for `action` should be rendered at all (allowed, or disabled with a reason). */
export function isVisible(role: OrgRole | null | undefined, action: OrgAction, ctx?: PermissionContext): boolean {
  const result = can(role, action, ctx);
  return result.allowed || !result.hidden;
}
