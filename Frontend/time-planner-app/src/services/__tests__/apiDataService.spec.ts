/**
 * Org tasks in the API layer (D7): TaskItemDto normalization and the organization endpoints
 * (route + body) for editable org tasks. apiService is mocked; no network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("../apiService", () => ({ default: api }));

import { apiDataService, normalizeTask } from "../apiDataService";
import { taskCapabilities } from "@/lib/taskAccess";
import type { Task } from "@/types";

const ORG = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const personalDto = {
  id: "p1",
  title: "Gym",
  start: "2026-10-05T16:00:00Z",
  duration: 1,
  categoryId: "c1",
  categoryName: "Health",
  categoryColor: "#22aa66",
  organizationId: null,
  organizationName: null,
  assignees: [],
  createdBy: { userId: "me", displayName: "Me" },
  capabilities: { canEdit: true, canDelete: true, canReassign: false },
};

const assignedDto = {
  ...personalDto,
  id: "o1",
  title: "Customer call",
  start: "2026-10-05T09:00:00",
  organizationId: ORG,
  organizationName: " Acme ",
  assignees: [
    { userId: "me", displayName: "Me", email: "me@example.com" },
    { userId: "u2", displayName: "", email: "kari@example.com" },
  ],
  createdBy: { userId: "admin", displayName: "Ada Admin" },
  capabilities: { canEdit: false, canDelete: false, canReassign: false },
};

beforeEach(() => vi.resetAllMocks());

describe("normalizeTask (TaskItemDto)", () => {
  it("keeps org fields, trims the org name and fills display names", () => {
    const task = normalizeTask(assignedDto as unknown as Task)!;
    expect(task.start).toBe("2026-10-05T09:00:00.000Z"); // offset-less = UTC
    expect(task.organizationId).toBe(ORG);
    expect(task.organizationName).toBe("Acme");
    expect(task.assignees).toEqual([
      { userId: "me", displayName: "Me", email: "me@example.com" },
      { userId: "u2", displayName: "kari@example.com", email: "kari@example.com" },
    ]);
    expect(task.createdBy).toEqual({ userId: "admin", displayName: "Ada Admin" });
    expect(task.capabilities).toEqual({ canEdit: false, canDelete: false, canReassign: false });
  });

  it("personal tasks: null org, empty assignees", () => {
    const task = normalizeTask(personalDto as unknown as Task)!;
    expect(task.organizationId).toBeNull();
    expect(task.organizationName).toBeNull();
    expect(task.assignees).toEqual([]);
    expect(taskCapabilities(task)).toEqual({ canEdit: true, canDelete: true, canReassign: false });
  });

  it("older backends without the new fields → personal defaults", () => {
    const legacy = { id: "l1", title: "Old", start: "2026-10-05T08:00:00Z", duration: 1, categoryId: "c1", categoryName: "", categoryColor: "" };
    const task = normalizeTask(legacy)!;
    expect(task.organizationId).toBeNull();
    expect(task.assignees).toEqual([]);
    expect(task.createdBy).toBeNull();
    expect("capabilities" in task).toBe(false);
    expect(taskCapabilities(task).canEdit).toBe(true);
  });

  it("capabilities are strictly boolean (never guessed up)", () => {
    const odd = { ...assignedDto, capabilities: { canEdit: "yes", canDelete: 1 } };
    expect(normalizeTask(odd as unknown as Task)!.capabilities).toEqual({ canEdit: false, canDelete: false, canReassign: false });
  });

  it("getTasks normalizes every row", async () => {
    api.get.mockResolvedValue({ data: [personalDto, assignedDto] });
    const tasks = await apiDataService.getTasks({ start: "2026-10-05T00:00:00.000Z", end: "2026-10-12T00:00:00.000Z" });
    expect(tasks.map((t) => [t.id, t.organizationName])).toEqual([
      ["p1", null],
      ["o1", "Acme"],
    ]);
  });
});

describe("organization endpoints", () => {
  it("updateOrganizationTask → PUT /organizations/{orgId}/tasks/{id} with matching ids in the body", async () => {
    api.put.mockResolvedValue({ data: null });
    await apiDataService.updateOrganizationTask(ORG, "o1", {
      title: "Customer call",
      start: "2026-10-05T10:00:00Z",
      duration: 1.5,
      categoryId: "c9",
    });
    expect(api.put).toHaveBeenCalledWith(`/organizations/${ORG}/tasks/o1`, {
      organizationId: ORG,
      taskId: "o1",
      title: "Customer call",
      start: "2026-10-05T10:00:00.000Z",
      duration: 1.5,
      categoryId: "c9",
    });
  });

  it("updateTask (personal) sends only the personal fields to /tasks/{id}", async () => {
    api.put.mockResolvedValue({ data: null });
    const task = normalizeTask(personalDto as unknown as Task)!;
    await apiDataService.updateTask("p1", task);
    expect(api.put).toHaveBeenCalledWith("/tasks/p1", {
      title: "Gym",
      start: "2026-10-05T16:00:00.000Z",
      duration: 1,
      categoryId: "c1",
      templateId: undefined,
    });
  });

  it("deleteOrganizationTask → DELETE /organizations/{orgId}/tasks/{id}", async () => {
    api.delete.mockResolvedValue({ data: null });
    await apiDataService.deleteOrganizationTask(ORG, "o1");
    expect(api.delete).toHaveBeenCalledWith(`/organizations/${ORG}/tasks/o1`);
  });

  it("createOrganizationTask: with assignees → /tasks, without → /tasks/personal", async () => {
    api.post.mockResolvedValue({ data: { ...assignedDto, id: "new" } });
    const data = { title: "Customer call", start: "2026-10-05T09:00:00Z", duration: 1, categoryId: "c1" };

    const created = await apiDataService.createOrganizationTask(ORG, data, ["me", "u2"]);
    expect(api.post).toHaveBeenLastCalledWith(`/organizations/${ORG}/tasks`, {
      organizationId: ORG,
      title: "Customer call",
      start: "2026-10-05T09:00:00.000Z",
      duration: 1,
      categoryId: "c1",
      assigneeIds: ["me", "u2"],
    });
    expect(created.id).toBe("new");
    expect(created.organizationName).toBe("Acme");

    await apiDataService.createOrganizationTask(ORG, data, null);
    expect(api.post).toHaveBeenLastCalledWith(`/organizations/${ORG}/tasks/personal`, {
      organizationId: ORG,
      title: "Customer call",
      start: "2026-10-05T09:00:00.000Z",
      duration: 1,
      categoryId: "c1",
    });
  });
});
