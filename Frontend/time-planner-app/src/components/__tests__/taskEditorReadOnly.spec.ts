/**
 * The task editor opens an admin-assigned org task READ-ONLY (D7): who assigned it and where,
 * the assignees, and a Close button only — no fields, no Save, no Delete. Editable org tasks get
 * the normal form plus a "Created by … · Acme" line. Rendered with Vue's server renderer (the
 * project has no DOM test environment); UiDialog is replaced by a plain stand-in that renders
 * its title, default slot and footer slot (its focus trap/measuring need a real DOM).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { createPinia, setActivePinia } from "pinia";
import type { Task, TaskCapabilities } from "@/types";

vi.mock("@/services/authService", () => ({ authService: {} }));
vi.mock("@/components/ui/UiDialog.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    default: defineComponent({
      name: "UiDialogStub",
      props: { open: Boolean, title: String },
      setup(props, { slots }) {
        const close = () => {};
        return () =>
          props.open
            ? h("div", { role: "dialog", "aria-label": props.title }, [
                h("h2", props.title),
                slots.default?.({ close }),
                h("footer", slots.footer?.({ close })),
              ])
            : null;
      },
    }),
  };
});

import TaskEditor from "../TaskEditor.vue";
import { useTaskEditor } from "@/composables/useTaskEditor";
import { useTaskStore } from "@/stores/taskStore";
import { useAuthStore } from "@/stores/authStore";
import { resetCurrentUserCache } from "@/composables/useCurrentUser";

const memory = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, String(value)),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
  },
});

const CATEGORY = { id: "c1", name: "Work", color: "#2F7FE0" };

function orgTask(capabilities: TaskCapabilities): Task {
  return {
    id: "o1",
    title: "Customer call",
    start: "2026-10-05T09:00:00.000Z",
    duration: 1.5,
    categoryId: "foreign-cat", // the org's category, not one of mine
    categoryName: "Sales",
    categoryColor: "#AA3355",
    organizationId: "org-1",
    organizationName: "Acme",
    assignees: [
      { userId: "me", displayName: "Me Myself", email: "me@example.com" },
      { userId: "u2", displayName: "Kari Nordmann", email: "kari@example.com" },
    ],
    createdBy: { userId: "admin", displayName: "Ada Admin" },
    capabilities,
  };
}

/** A signed-in user's access token (only the `sub` claim matters here). */
const tokenFor = (userId: string) =>
  ["header", Buffer.from(JSON.stringify({ sub: userId })).toString("base64url"), "sig"].join(".");

async function renderEditor(
  task: Task,
  signedInAs: string | null = null,
  category: { name: string; color: string | null } | null = null
): Promise<string> {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().accessToken = signedInAs ? tokenFor(signedInAs) : null;
  useTaskStore().categories = [CATEGORY];
  useTaskEditor().openEdit(task, null, { category });
  const app = createSSRApp({ render: () => h(TaskEditor) });
  app.use(pinia);
  return renderToString(app);
}

/** Visible text, tags stripped (comments too). */
const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

beforeEach(() => {
  memory.clear();
  resetCurrentUserCache();
  useTaskEditor().close();
});

describe("read-only org task (assigned by an admin)", () => {
  it("shows who assigned it, where, and to whom — with a Close button only", async () => {
    const html = await renderEditor(orgTask({ canEdit: false, canDelete: false, canReassign: false }));
    const visible = text(html);
    expect(visible).toContain("Task in Acme");
    expect(visible).toContain("Customer call");
    expect(visible).toContain("Assigned by Ada Admin · Acme");
    expect(visible).toContain("Me Myself");
    expect(visible).toContain("Kari Nordmann");
    // Grouped under the organization (as in analytics), never the creator's own category name.
    expect(visible).toContain("Category Acme");
    expect(visible).not.toContain("Sales");
    expect(visible).toContain("Close");
    expect(visible).not.toMatch(/\bSave\b/);
    expect(visible).not.toMatch(/\bDelete\b/);
    expect(html).toContain("editor--readonly");
    expect(html).not.toMatch(/<input/); // no editable fields
  });
});

describe("read-only org task opened from the analytics task list", () => {
  it("shows the list's grouping (organization name and color), not the creator's category", async () => {
    const html = await renderEditor(orgTask({ canEdit: false, canDelete: false, canReassign: false }), null, {
      name: "Acme Ops",
      color: "#0E9C8C",
    });
    expect(text(html)).toContain("Category Acme Ops");
    expect(text(html)).not.toContain("Sales");
    expect(html).toMatch(/background-color:\s*#0E9C8C/i);
  });
});

describe("editable org task (created by me / I'm an admin)", () => {
  it("has the normal form, the org line and Save/Delete", async () => {
    const html = await renderEditor(orgTask({ canEdit: true, canDelete: true, canReassign: false }));
    const visible = text(html);
    expect(visible).toContain("Created by Ada Admin · Acme");
    expect(visible).toMatch(/\bSave\b/);
    expect(visible).toMatch(/\bDelete\b/);
    expect(html).not.toContain("editor--readonly");
    expect(html).toMatch(/<input/);
  });

  it("no Delete when the server says I can't delete it", async () => {
    const html = await renderEditor(orgTask({ canEdit: true, canDelete: false, canReassign: false }));
    expect(text(html)).not.toMatch(/\bDelete\b/);
    expect(text(html)).toMatch(/\bSave\b/);
  });
});

describe("wording from the signed-in user's side", () => {
  const EDITABLE: TaskCapabilities = { canEdit: true, canDelete: true, canReassign: false };

  it("my own org task: 'Created by you · Acme', no 'for Carol Member'", async () => {
    const mine: Task = {
      ...orgTask(EDITABLE),
      createdBy: { userId: "me", displayName: "Me Myself" },
      assignees: [{ userId: "me", displayName: "Me Myself", email: "me@example.com" }],
    };
    const visible = text(await renderEditor(mine, "me"));
    expect(visible).toContain("Created by you · Acme");
    expect(visible).not.toContain("Me Myself");
    expect(visible).not.toContain("· for");
  });

  it("assigned to me and others: 'for you and 1 other'", async () => {
    const visible = text(await renderEditor(orgTask(EDITABLE), "me"));
    expect(visible).toContain("Created by Ada Admin · Acme");
    expect(visible).toContain("· for you and 1 other");
  });

  it("read-only: 'You' heads the assignee list", async () => {
    const html = await renderEditor(orgTask({ canEdit: false, canDelete: false, canReassign: false }), "me");
    expect(text(html)).toContain("Assigned to You Kari Nordmann");
    expect(text(html)).not.toContain("Me Myself");
  });
});
