// src/types/index.ts
import type { UtcIsoString } from "@/lib/datetime";

// --- Authentication ---

// Response from the backend's login/refresh endpoints
export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
}

// --- DTOs for Guest Data Migration (must match backend exactly) ---

export interface CategoryMigrationDto {
  id: string; // The old string ID from the frontend
  name: string;
  color: string;
}

export interface TaskTemplateMigrationDto {
  id: string;
  title: string;
  duration: number;
  categoryId: string;
}

export interface TaskItemMigrationDto {
  title: string;
  /** Instant, normalized to `YYYY-MM-DDTHH:mm:ss.sssZ` before sending. */
  start: UtcIsoString;
  duration: number;
  categoryId: string;
  templateId?: string;
}

export interface MigrationData {
  categories: CategoryMigrationDto[];
  templates: TaskTemplateMigrationDto[];
  tasks: TaskItemMigrationDto[];
}

// --- Domain models (match the backend DTOs) ---

export interface Task {
  id: string;
  title: string;
  /**
   * Start instant, always canonical UTC `YYYY-MM-DDTHH:mm:ss.sssZ` in memory
   * (normalized by apiDataService / localDataService). Use `src/lib/datetime.ts` for any math.
   */
  start: UtcIsoString;
  duration: number; // in hours (elapsed time)
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  templateId?: string; // Optional: to link back to a template

  // --- Organization tasks in "my planner" (D7). Absent/empty for personal and guest tasks. ---
  /** Organization the task belongs to; null/absent for personal tasks. */
  organizationId?: string | null;
  organizationName?: string | null;
  /** Members the org task is assigned to (empty for personal tasks). */
  assignees?: TaskAssignee[];
  /** Who created the task (org tasks). */
  createdBy?: TaskCreator | null;
  /**
   * What the current user may do (server-computed). Absent → personal defaults for personal
   * tasks, read-only for org tasks (see src/lib/taskAccess.ts).
   */
  capabilities?: TaskCapabilities;
}

export interface TaskAssignee {
  userId: string;
  /** Display name, falling back to the email. */
  displayName: string;
  email: string;
}

export interface TaskCreator {
  userId: string;
  displayName: string;
}

export interface TaskCapabilities {
  canEdit: boolean;
  canDelete: boolean;
  canReassign: boolean;
}

export interface TaskTemplate {
  id: string;
  title: string;
  duration: number;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
}

// --- API request payloads ---
export interface CreateCategoryRequest {
  name: string;
  color: string;
}

export type UpdateCategoryRequest = CreateCategoryRequest;

export interface CreateTaskTemplateRequest {
  title: string;
  duration: number;
  categoryId: string;
}

export type UpdateTaskTemplateRequest = CreateTaskTemplateRequest;

export interface CreateTaskRequest {
  title: string;
  /** Canonical UTC instant (`YYYY-MM-DDTHH:mm:ss.sssZ`). */
  start: UtcIsoString;
  duration: number;
  categoryId: string;
  templateId?: string;
}

export type UpdateTaskRequest = CreateTaskRequest;

export interface BreakdownDataPoint {
  /**
   * Bucket id in the user's zone: `"yyyy-MM"` (monthly), `"yyyy-Www"` (weekly, e.g. "2026-W05"),
   * `"yyyy-MM-dd"` (daily). Absent on older backends: fall back to `label`.
   */
  key?: string;
  label: string;
  value: number;
  dominantCategoryColor: string;
}

export interface TimePerCategory {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  totalHours: number;
}

export interface TimePerTemplate {
  templateId?: string;
  templateTitle?: string;
  categoryColor?: string;
  totalHours: number;
}

export interface TaskAnalyticsResponse {
  totalHours: number;
  timePerCategory: TimePerCategory[];
  timePerTemplate: TimePerTemplate[];
  breakdownData: BreakdownDataPoint[];
}
