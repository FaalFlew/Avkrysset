/**
 * The permission matrix (docs/plans/organizations-phase3.md §6, with §8 Q-E approved): every row ×
 * role. ✓ allowed · ✗ hidden (the role can never do it) · ◐ disabled with a reason. A wrong cell
 * either shows a control the API refuses or hides one the user needs. Plus parity of
 * taskCapabilitiesFor with the server's TaskCapabilities.For.
 */
import { describe, expect, it } from "vitest";
import { can, taskCapabilitiesFor, type OrgAction, type PermissionContext, type TargetMember } from "../orgPermissions";
import type { OrgRole } from "@/types/org";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const ORG = "99999999-9999-9999-9999-999999999999";

const owner: TargetMember = { userId: "o", role: "Owner" };
const admin: TargetMember = { userId: "a", role: "Admin" };
const member: TargetMember = { userId: "m", role: "Member" };
const taskByMe = { organizationId: ORG, createdBy: { userId: ME, displayName: "Me" } };
const taskByOther = { organizationId: ORG, createdBy: { userId: OTHER, displayName: "Ana" } };

type Cell = "✓" | "✗" | "◐";
type Row = [OrgAction, PermissionContext, Cell, Cell, Cell];

// [action, context, Owner, Admin, Member]
const MATRIX: Row[] = [
  ["org.view", {}, "✓", "✓", "✓"],
  ["org.edit", {}, "✓", "✓", "✗"],
  ["org.delete", {}, "✓", "✗", "✗"],
  ["org.transferOwnership", { target: admin }, "✓", "✗", "✗"],
  ["org.transferOwnership", { activeAdminCount: 2 }, "✓", "✗", "✗"],
  ["org.transferOwnership", { activeAdminCount: 0 }, "◐", "✗", "✗"],
  ["org.transferOwnership", { target: member }, "◐", "✗", "✗"],
  ["org.regenerateCodes", {}, "✓", "✗", "✗"],
  ["org.viewCodes", {}, "✓", "✓", "✗"],
  ["invitations.manage", {}, "✓", "✓", "✗"],
  ["member.changeRole", { target: member, newRole: "Admin" }, "✓", "✓", "✗"],
  ["member.changeRole", { target: admin, newRole: "Member" }, "✓", "◐", "✗"],
  ["member.changeRole", { target: owner, newRole: "Member" }, "✗", "✗", "✗"],
  ["member.changeRole", { target: { ...member, status: "Left" }, newRole: "Admin" }, "✗", "✗", "✗"],
  ["member.remove", { target: member }, "✓", "✓", "✗"],
  ["member.remove", { target: admin }, "✓", "◐", "✗"],
  ["member.remove", { target: owner }, "✗", "✗", "✗"],
  ["member.remove", { target: { ...member, status: "Removed" } }, "✗", "✗", "✗"],
  ["org.leave", {}, "◐", "✓", "✓"],
  ["member.editOwnStatus", {}, "✓", "✓", "✓"],
  ["schedule.viewAll", {}, "✓", "✓", "✗"],
  ["task.createForOthers", {}, "✓", "✓", "✗"],
  ["task.createOwn", {}, "✓", "✓", "✓"],
  ["task.edit", { task: taskByMe }, "✓", "✓", "✓"],
  ["task.edit", { task: taskByOther }, "✓", "✓", "✗"],
  ["task.delete", { task: taskByMe }, "✓", "✓", "✓"],
  ["task.delete", { task: taskByOther }, "✓", "✓", "✗"],
  ["task.reassign", {}, "✓", "✓", "✗"],
  ["board.manage", {}, "✓", "✓", "✗"],
  ["analytics.viewOrg", {}, "✓", "✓", "✗"],
  ["analytics.viewMember", { memberId: OTHER }, "✓", "✓", "✗"],
  ["analytics.viewMember", { memberId: ME }, "✓", "✓", "✓"],
  ["activity.viewAllTasks", {}, "✓", "✓", "✗"],
];

function cell(role: OrgRole, action: OrgAction, ctx: PermissionContext): Cell {
  const result = can(role, action, { meId: ME, ...ctx });
  if (result.allowed) return "✓";
  expect(result.reason, `${role} ${action}: a refusal always says why`).not.toBe("");
  return result.hidden ? "✗" : "◐";
}

describe("can() follows the permission matrix", () => {
  it.each(MATRIX)("%s %o → Owner %s · Admin %s · Member %s", (action, ctx, o, a, m) => {
    expect([cell("Owner", action, ctx), cell("Admin", action, ctx), cell("Member", action, ctx)]).toEqual([o, a, m]);
  });

  it("hides everything from someone who is not an active member", () => {
    for (const [action, ctx] of MATRIX) {
      for (const role of [null, undefined]) {
        const result = can(role, action, { meId: ME, ...ctx });
        expect(result.allowed, action).toBe(false);
        if (!result.allowed) expect(result.hidden, action).toBe(true);
      }
    }
  });

  it("explains the circumstantial refusals", () => {
    const reason = (role: OrgRole, action: OrgAction, ctx: PermissionContext = {}) => {
      const result = can(role, action, ctx);
      return result.allowed ? null : result.reason;
    };
    expect(reason("Owner", "org.leave")).toBe("Transfer ownership first.");
    expect(reason("Admin", "member.remove", { target: admin })).toBe("Only the owner can remove an admin.");
    expect(reason("Admin", "member.changeRole", { target: admin, newRole: "Member" })).toMatch(/only the owner/i);
    expect(reason("Owner", "org.transferOwnership", { activeAdminCount: 0 })).toBe("Make someone an admin first.");
  });

  it("compares user ids case-insensitively (JWT sub vs. GUIDs from the API)", () => {
    expect(can("Member", "task.edit", { task: taskByMe, meId: ME.toUpperCase() }).allowed).toBe(true);
    expect(can("Member", "analytics.viewMember", { memberId: ME.toUpperCase(), meId: ME }).allowed).toBe(true);
  });
});

describe("taskCapabilitiesFor = server TaskCapabilities.For", () => {
  const all = { canEdit: true, canDelete: true, canReassign: true };
  const editOnly = { canEdit: true, canDelete: true, canReassign: false };
  const none = { canEdit: false, canDelete: false, canReassign: false };

  it.each([
    ["personal task, any role", null, { organizationId: null, createdBy: null }, editOnly],
    ["personal task, member", "Member", { organizationId: null, createdBy: null }, editOnly],
    ["owner", "Owner", taskByOther, all],
    ["admin", "Admin", taskByOther, all],
    ["member who created it", "Member", taskByMe, editOnly],
    ["member, assigned by someone else", "Member", taskByOther, none],
    ["member, unknown creator", "Member", { organizationId: ORG, createdBy: null }, none],
    ["not a member", null, taskByMe, none],
  ] as const)("%s", (_label, role, task, expected) => {
    expect(taskCapabilitiesFor(role, task, ME)).toEqual(expected);
  });

  it("never grants a member anything without knowing who they are", () => {
    expect(taskCapabilitiesFor("Member", taskByMe, null)).toEqual(none);
  });
});
