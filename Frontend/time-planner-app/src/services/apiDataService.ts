// src/services/apiDataService.ts
import apiService from "./apiService";
import type {
  Category,
  Task,
  TaskTemplate,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CreateTaskTemplateRequest,
  UpdateTaskTemplateRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  TaskAnalyticsResponse,
  TaskAssignee,
  TaskCapabilities,
  TaskCreator,
} from "@/types";
import {
  dayRange,
  isInRange,
  normalizeApiInstant,
  toApiInstant,
  type DateKey,
  type InstantRange,
} from "@/lib/datetime";

/** Raw org fields as the API may send them (older/newer shapes tolerated). */
interface RawPerson {
  userId?: string;
  id?: string;
  displayName?: string | null;
  email?: string | null;
  userEmail?: string | null;
}

interface RawCapabilities {
  canEdit?: unknown;
  canDelete?: unknown;
  canReassign?: unknown;
}

function personId(p: RawPerson): string {
  return String(p.userId ?? p.id ?? "");
}

function normalizeAssignees(raw: unknown): TaskAssignee[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is RawPerson => !!p && typeof p === "object")
    .map((p) => {
      const email = (p.email ?? p.userEmail ?? "").trim();
      return { userId: personId(p), displayName: p.displayName?.trim() || email, email };
    });
}

function normalizeCreator(raw: unknown): TaskCreator | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as RawPerson;
  const name = p.displayName?.trim() || p.email?.trim() || p.userEmail?.trim() || "";
  return { userId: personId(p), displayName: name };
}

function normalizeCapabilities(raw: unknown): TaskCapabilities | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as RawCapabilities;
  return { canEdit: c.canEdit === true, canDelete: c.canDelete === true, canReassign: c.canReassign === true };
}

/**
 * Bring a task from the API into canonical form (`start` as `YYYY-MM-DDTHH:mm:ss.sssZ`).
 * Older backends sent `start` without an offset; that is UTC. Org fields (D7) are normalized:
 * `organizationId`/`organizationName` null for personal tasks, `assignees` always an array,
 * `capabilities` only when the server sent them (src/lib/taskAccess.ts supplies defaults).
 * Returns `null` (and logs) for a task whose start cannot be parsed, so one bad row cannot break
 * the whole view.
 */
export function normalizeTask(task: Task): Task | null {
  try {
    const raw = task as Task & { assignees?: unknown; createdBy?: unknown; capabilities?: unknown };
    const normalized: Task = {
      ...task,
      start: normalizeApiInstant(task.start),
      organizationId: task.organizationId || null,
      organizationName: task.organizationName?.trim() || null,
      assignees: normalizeAssignees(raw.assignees),
      createdBy: normalizeCreator(raw.createdBy),
    };
    const capabilities = normalizeCapabilities(raw.capabilities);
    if (capabilities) normalized.capabilities = capabilities;
    else delete normalized.capabilities;
    return normalized;
  } catch (error) {
    console.error("Ignoring task with an invalid start from the API:", task, error);
    return null;
  }
}

function normalizeTasks(tasks: Task[]): Task[] {
  return tasks.map(normalizeTask).filter((t): t is Task => t !== null);
}

/** Request body with a canonical UTC start, whatever instant format the caller had. */
function withApiStart<T extends { start: string }>(data: T): T {
  return { ...data, start: toApiInstant(data.start) };
}

// --- Category Functions ---
async function getCategories(): Promise<Category[]> {
  const response = await apiService.get<Category[]>("/categories");
  return response.data;
}

async function createCategory(data: CreateCategoryRequest): Promise<Category> {
  const response = await apiService.post<Category>("/categories", data);
  return response.data;
}

async function updateCategory(
  id: string,
  data: UpdateCategoryRequest
): Promise<void> {
  await apiService.put(`/categories/${id}`, data);
}

async function deleteCategory(id: string): Promise<void> {
  await apiService.delete(`/categories/${id}`);
}

// --- Task Template Functions ---
async function getTaskTemplates(): Promise<TaskTemplate[]> {
  const response = await apiService.get<TaskTemplate[]>("/tasktemplates");
  return response.data;
}

async function createTaskTemplate(
  data: CreateTaskTemplateRequest
): Promise<TaskTemplate> {
  const response = await apiService.post<TaskTemplate>("/tasktemplates", data);
  return response.data;
}

async function updateTaskTemplate(
  id: string,
  data: UpdateTaskTemplateRequest
): Promise<void> {
  await apiService.put(`/tasktemplates/${id}`, data);
}

async function deleteTaskTemplate(id: string): Promise<void> {
  await apiService.delete(`/tasktemplates/${id}`);
}

// --- Task Functions ---

/**
 * Tasks starting in the half-open range `[range.start, range.end)`.
 * The result is filtered client-side as well, because older backends extended `end` by a day.
 */
async function getTasks(range: InstantRange): Promise<Task[]> {
  const response = await apiService.get<Task[]>("/tasks", {
    params: { startDate: range.start, endDate: range.end },
  });
  return normalizeTasks(response.data).filter((task) => isInRange(task.start, range));
}

/** Tasks starting on a calendar day in the user's time zone. */
async function getTasksForDay(day: DateKey): Promise<Task[]> {
  return getTasks(dayRange(day));
}

async function getTaskYears(): Promise<number[]> {
  const response = await apiService.get<number[]>("/tasks/years");
  return response.data;
}

/** Only the fields the personal task endpoints accept. */
function personalTaskBody(data: CreateTaskRequest): CreateTaskRequest {
  return withApiStart({
    title: data.title,
    start: data.start,
    duration: data.duration,
    categoryId: data.categoryId,
    templateId: data.templateId,
  });
}

function requireTask(raw: Task): Task {
  const task = normalizeTask(raw);
  if (!task) throw new Error("The server returned a task with an invalid start.");
  return task;
}

async function createTask(data: CreateTaskRequest): Promise<Task> {
  const response = await apiService.post<Task>("/tasks", personalTaskBody(data));
  return requireTask(response.data);
}

async function updateTask(id: string, data: UpdateTaskRequest): Promise<void> {
  await apiService.put(`/tasks/${id}`, personalTaskBody(data));
}

async function deleteTask(id: string): Promise<void> {
  await apiService.delete(`/tasks/${id}`);
}

// --- Organization tasks in "my planner" (D7) ---
// Personal endpoints refuse org tasks; editable org tasks are saved through the org endpoints.

/** Body of UpdateOrganizationTaskCommand (route ids must match the body). */
export interface UpdateOrganizationTaskBody {
  organizationId: string;
  taskId: string;
  title: string;
  start: string;
  duration: number;
  categoryId: string;
}

async function updateOrganizationTask(
  organizationId: string,
  taskId: string,
  data: Pick<UpdateTaskRequest, "title" | "start" | "duration" | "categoryId">
): Promise<void> {
  const body: UpdateOrganizationTaskBody = withApiStart({
    organizationId,
    taskId,
    title: data.title,
    start: data.start,
    duration: data.duration,
    categoryId: data.categoryId,
  });
  await apiService.put(`/organizations/${organizationId}/tasks/${taskId}`, body);
}

async function deleteOrganizationTask(organizationId: string, taskId: string): Promise<void> {
  await apiService.delete(`/organizations/${organizationId}/tasks/${taskId}`);
}

/**
 * Re-create an org task (Undo of a delete): with assignees through the admin endpoint, else as
 * the member's own org task (CreatePersonalOrganizationTaskCommand).
 */
async function createOrganizationTask(
  organizationId: string,
  data: Pick<CreateTaskRequest, "title" | "start" | "duration" | "categoryId">,
  assigneeIds: string[] | null
): Promise<Task> {
  const base = withApiStart({
    organizationId,
    title: data.title,
    start: data.start,
    duration: data.duration,
    categoryId: data.categoryId,
  });
  const response = assigneeIds && assigneeIds.length > 0
    ? await apiService.post<Task>(`/organizations/${organizationId}/tasks`, { ...base, assigneeIds })
    : await apiService.post<Task>(`/organizations/${organizationId}/tasks/personal`, base);
  return requireTask(response.data);
}

/** The signed-in user's profile (GET /api/users/me). */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
}

async function getMyProfile(): Promise<UserProfile> {
  const response = await apiService.get<UserProfile>("/users/me");
  return response.data;
}

/**
 * Set my display name (PUT /api/users/me): trimmed, ≤ 100 characters; empty clears it (the org UI
 * then shows the email). Returns the updated profile.
 */
async function updateMyProfile(data: { displayName: string | null }): Promise<UserProfile> {
  const displayName = data.displayName?.trim() ?? "";
  const response = await apiService.put<UserProfile>("/users/me", { displayName });
  return { ...response.data, displayName: response.data.displayName?.trim() || null };
}

/**
 * Analytics for tasks starting in `[range.start, range.end)`. Breakdown buckets follow the
 * calendar of the `X-Time-Zone` header (see `src/lib/analyticsBuckets.ts`).
 */
async function getTaskAnalytics(
  range: InstantRange,
  viewType: "monthly" | "weekly" | "daily"
): Promise<TaskAnalyticsResponse> {
  const response = await apiService.get<TaskAnalyticsResponse>(
    "/tasks/analytics",
    {
      params: { startDate: range.start, endDate: range.end, viewType },
    }
  );
  return response.data;
}

export const apiDataService = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getTaskTemplates,
  createTaskTemplate,
  updateTaskTemplate,
  deleteTaskTemplate,
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  updateOrganizationTask,
  deleteOrganizationTask,
  createOrganizationTask,
  getMyProfile,
  updateMyProfile,
  getTaskAnalytics,
  getTaskYears,
  getTasksForDay,
};
