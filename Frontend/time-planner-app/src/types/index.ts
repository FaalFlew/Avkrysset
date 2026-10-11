// src/types/index.ts

// --- ADDED SECTION for Authentication and Data Migration ---

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
  start: string; // ISO 8601 string
  duration: number;
  categoryId: string;
  templateId?: string;
}

export interface MigrationData {
  categories: CategoryMigrationDto[];
  templates: TaskTemplateMigrationDto[];
  tasks: TaskItemMigrationDto[];
}

// MODIFIED FILE: src/types/index.ts

// MODIFICATION: Updated to match the backend's TaskItemDto
export interface Task {
  id: string;
  title: string;
  start: string; // ISO 8601 string for date and time
  duration: number; // in hours
  categoryId: string;
  categoryName: string; // ADDED
  categoryColor: string; // ADDED
  templateId?: string; // Optional: to link back to a template
}

// MODIFICATION: Updated to match the backend's TaskTemplateDto
export interface TaskTemplate {
  id: string;
  title: string;
  duration: number;
  categoryId: string;
  categoryName: string; // ADDED
  categoryColor: string; // ADDED
}

// MODIFICATION: Updated to match the backend's CategoryDto
export interface Category {
  id: string;
  name: string;
  color: string;
}

// --- ADDED SECTION for API Request Payloads ---
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
  start: string;
  duration: number;
  categoryId: string;
  templateId?: string;
}

export type UpdateTaskRequest = CreateTaskRequest;

export interface BreakdownDataPoint {
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

// ... existing migration and auth types ...
