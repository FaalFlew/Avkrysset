import apiService from "./apiService";
import {
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
} from "@/types";
import dayjs from "dayjs";

// --- Category Functions ---
async function getCategories(): Promise<Category[]> {
  const response = await apiService.get<Category[]>("/categories");
  return response.data;
}

// ADDED: Function to get analytics data from the server
async function getTaskAnalytics(
  startDate: string,
  endDate: string,
  viewType: "monthly" | "weekly" | "daily"
): Promise<TaskAnalyticsResponse> {
  const response = await apiService.get<TaskAnalyticsResponse>(
    "/tasks/analytics",
    {
      params: { startDate, endDate, viewType },
    }
  );
  return response.data;
}

// ADDED createCategory
async function createCategory(data: CreateCategoryRequest): Promise<Category> {
  const response = await apiService.post<Category>("/categories", data);
  return response.data;
}

// ADDED updateCategory
async function updateCategory(
  id: string,
  data: UpdateCategoryRequest
): Promise<void> {
  await apiService.put(`/categories/${id}`, data);
}

// ADDED deleteCategory
async function deleteCategory(id: string): Promise<void> {
  await apiService.delete(`/categories/${id}`);
}

// --- Task Template Functions ---
async function getTaskTemplates(): Promise<TaskTemplate[]> {
  const response = await apiService.get<TaskTemplate[]>("/tasktemplates");
  return response.data;
}

// ADDED createTaskTemplate
async function createTaskTemplate(
  data: CreateTaskTemplateRequest
): Promise<TaskTemplate> {
  const response = await apiService.post<TaskTemplate>("/tasktemplates", data);
  return response.data;
}

// ADDED updateTaskTemplate
async function updateTaskTemplate(
  id: string,
  data: UpdateTaskTemplateRequest
): Promise<void> {
  await apiService.put(`/tasktemplates/${id}`, data);
}

// ADDED deleteTaskTemplate
async function deleteTaskTemplate(id: string): Promise<void> {
  await apiService.delete(`/tasktemplates/${id}`);
}

// --- Task Functions ---
async function getTasks(startDate: string, endDate: string): Promise<Task[]> {
  const response = await apiService.get<Task[]>("/tasks", {
    params: { startDate, endDate },
  });
  return response.data;
}

async function getTaskYears(): Promise<number[]> {
  const response = await apiService.get<number[]>("/tasks/years");
  return response.data;
}
// ADDED createTask
async function createTask(data: CreateTaskRequest): Promise<Task> {
  const response = await apiService.post<Task>("/tasks", data);
  return response.data;
}

// ADDED updateTask
async function updateTask(id: string, data: UpdateTaskRequest): Promise<void> {
  await apiService.put(`/tasks/${id}`, data);
}

// ADDED deleteTask
async function deleteTask(id: string): Promise<void> {
  await apiService.delete(`/tasks/${id}`);
}

async function getTasksForDay(date: dayjs.Dayjs): Promise<Task[]> {
  const startDate = date.startOf("day").toISOString();
  const endDate = date.endOf("day").toISOString();
  // We can reuse the existing getTasks endpoint, which is efficient.
  const response = await apiService.get<Task[]>("/tasks", {
    params: { startDate, endDate },
  });
  return response.data;
}
// MODIFIED export to include all new functions
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
  getTaskAnalytics,
  getTaskYears,
  getTasksForDay,
};
