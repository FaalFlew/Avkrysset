/** What the signed-in user may do with a task (D7): capability defaults, editor mode, labels. */
import { describe, expect, it } from "vitest";
import {
  canDeleteTask,
  canEditTask,
  checksOverlap,
  editorModeFor,
  isOrgTask,
  isReadOnlyTask,
  managedMessage,
  OVERLAP_MESSAGE,
  orgAttribution,
  orgMonogram,
  organizationLabel,
  overlapIndex,
  overlapMessage,
  taskCapabilities,
} from "@/lib/taskAccess";
import { formatTaskLabel } from "@/lib/plannerFormat";
import type { Task } from "@/types";

const base: Task = {
  id: "t1",
  title: "Standup",
  start: "2026-06-10T07:00:00.000Z",
  duration: 1,
  categoryId: "c1",
  categoryName: "Work",
  categoryColor: "#336699",
};
const ORG = { organizationId: "org-1", organizationName: "Acme" };
const assigned: Task = { ...base, ...ORG, capabilities: { canEdit: false, canDelete: false, canReassign: false } };
const selfCreated: Task = { ...base, ...ORG, capabilities: { canEdit: true, canDelete: true, canReassign: false } };
const asAdmin: Task = { ...base, ...ORG, capabilities: { canEdit: true, canDelete: true, canReassign: true } };

describe("capabilities", () => {
  it("personal and guest tasks (no capabilities) are editable and deletable", () => {
    expect(isOrgTask(base)).toBe(false);
    expect(taskCapabilities(base)).toEqual({ canEdit: true, canDelete: true, canReassign: false });
    expect(taskCapabilities({ ...base, organizationId: null })).toEqual({ canEdit: true, canDelete: true, canReassign: false });
    expect(editorModeFor(base)).toBe("edit");
  });

  it("admin-assigned org tasks are read-only for a member", () => {
    expect(canEditTask(assigned)).toBe(false);
    expect(canDeleteTask(assigned)).toBe(false);
    expect(isReadOnlyTask(assigned)).toBe(true);
    expect(editorModeFor(assigned)).toBe("readonly");
  });

  it("org tasks I created for myself, and every org task for Owner/Admin, are editable", () => {
    expect(editorModeFor(selfCreated)).toBe("edit");
    expect(canDeleteTask(selfCreated)).toBe(true);
    expect(taskCapabilities(asAdmin).canReassign).toBe(true);
  });

  it("an org task without capabilities is read-only (never guess permissions up)", () => {
    expect(taskCapabilities({ ...base, ...ORG })).toEqual({ canEdit: false, canDelete: false, canReassign: false });
    expect(isOrgTask({ organizationId: "" })).toBe(false);
  });

  it("no task → create mode", () => {
    expect(editorModeFor(null)).toBe("create");
  });
});

describe("labels", () => {
  it("organization name, managed message and monogram", () => {
    expect(organizationLabel(assigned)).toBe("Acme");
    expect(organizationLabel({ organizationName: "  " })).toBe("your organization");
    expect(managedMessage(assigned)).toBe("This task is managed in Acme.");
    expect(orgMonogram("Acme")).toBe("A");
    expect(orgMonogram("blue sky labs")).toBe("BS");
    expect(orgMonogram("Ørsted")).toBe("Ø");
    expect(orgMonogram("")).toBe("•");
    expect(orgMonogram(null)).toBe("•");
  });

  it("screen-reader label names the organization", () => {
    expect(formatTaskLabel(assigned, "Work", "Acme")).toMatch(/, Acme task$/);
    expect(formatTaskLabel(base, "Work")).not.toMatch(/task$/);
  });
});

describe("overlaps (Q3)", () => {
  it("only personal tasks are pre-checked for overlaps", () => {
    expect(checksOverlap(base)).toBe(true);
    expect(checksOverlap(assigned)).toBe(false);
    expect(checksOverlap(selfCreated)).toBe(false);
  });

  it("overlapIndex lists each task's overlapping tasks (half-open)", () => {
    const a: Task = { ...base, id: "a", start: "2026-06-10T07:00:00Z", duration: 2 };
    const b: Task = { ...base, id: "b", start: "2026-06-10T08:00:00Z", duration: 1 };
    const c: Task = { ...base, id: "c", start: "2026-06-10T09:00:00Z", duration: 1 }; // touches a and b
    const index = overlapIndex([a, b, c]);
    expect(index.get("a")?.map((t) => t.id)).toEqual(["b"]);
    expect(index.get("b")?.map((t) => t.id)).toEqual(["a"]);
    expect(index.has("c")).toBe(false);
  });
});

describe("overlap wording (client pre-check = server wording)", () => {
  it("an assigned org task names its organization; anything else is generic", () => {
    expect(overlapMessage(assigned)).toBe("This time overlaps a task assigned to you in Acme.");
    expect(overlapMessage({ organizationId: "org-1", organizationName: null })).toBe(
      "This time overlaps a task assigned to you in your organization."
    );
    expect(overlapMessage(base)).toBe(OVERLAP_MESSAGE);
    expect(overlapMessage(undefined)).toBe("This time slot overlaps with an existing task.");
  });
});

describe("orgAttribution (editor wording)", () => {
  const ME = "3F2504E0-4F89-11D3-9A0C-0305E82C3301";
  const me = { userId: ME.toLowerCase(), displayName: "Carol Member", email: "carol@example.com" };
  const kari = { userId: "u2", displayName: "Kari Nordmann", email: "kari@example.com" };
  const ola = { userId: "u3", displayName: "", email: "ola@example.com" };
  const t = (createdBy: { userId: string; displayName: string }, assignees: (typeof me)[]) => ({
    organizationName: "Acme Org",
    createdBy,
    assignees,
  });

  it("my own org task: 'Created by you · Acme Org' without a redundant 'for you'", () => {
    const a = orgAttribution(t({ userId: me.userId, displayName: "Carol Member" }, [me]), ME, false);
    expect(a.line).toBe("Created by you · Acme Org");
    expect(a.forWhom).toBeNull();
    expect(a.people).toEqual(["You"]);
  });

  it("I'm among the assignees: 'for you' / 'for you and N others'", () => {
    const admin = { userId: "admin", displayName: "Ada Admin" };
    expect(orgAttribution(t(admin, [me]), ME, false)).toEqual({
      line: "Created by Ada Admin · Acme Org",
      forWhom: "for you",
      people: ["You"],
    });
    expect(orgAttribution(t(admin, [kari, me]), ME, false).forWhom).toBe("for you and 1 other");
    expect(orgAttribution(t({ userId: me.userId, displayName: "Carol" }, [me, kari, ola]), ME, false)).toEqual({
      line: "Created by you · Acme Org",
      forWhom: "for you and 2 others",
      people: ["You", "Kari Nordmann", "ola@example.com"],
    });
  });

  it("not assigned to me (an admin's view): names the assignees", () => {
    const a = orgAttribution(t({ userId: me.userId, displayName: "Carol" }, [kari, ola]), ME, false);
    expect(a.forWhom).toBe("for Kari Nordmann, ola@example.com");
    expect(a.people).toEqual(["Kari Nordmann", "ola@example.com"]);
  });

  it("read-only: 'Assigned by …'", () => {
    const a = orgAttribution(t({ userId: "admin", displayName: "Ada Admin" }, [me, kari]), ME, true);
    expect(a.line).toBe("Assigned by Ada Admin · Acme Org");
    expect(a.people).toEqual(["You", "Kari Nordmann"]);
  });

  it("unknown user (guest / id not loaded yet): names only, never 'you'", () => {
    const a = orgAttribution(t({ userId: me.userId, displayName: "Carol Member" }, [me]), null, false);
    expect(a.line).toBe("Created by Carol Member · Acme Org");
    expect(a.forWhom).toBe("for Carol Member");
  });

  it("no creator: just the organization", () => {
    expect(orgAttribution({ organizationName: "Acme Org", createdBy: null, assignees: [] }, ME, false)).toEqual({
      line: "Acme Org",
      forWhom: null,
      people: [],
    });
  });
});
