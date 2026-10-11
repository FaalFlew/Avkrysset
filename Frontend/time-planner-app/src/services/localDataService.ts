// src/services/taskService.ts

import { Task, TaskTemplate, Category } from "@/types";

const TEMPLATES_STORAGE_KEY = "vue-time-planner-templates";

// A helper to get items from localStorage and parse them

// --- Task Service ---
export const taskService = {
  getTasks: (): Task[] => getItems<Task>(TASKS_STORAGE_KEY),
  saveTasks: (tasks: Task[]): void => saveItems<Task>(TASKS_STORAGE_KEY, tasks),
};

// --- Template Service ---
export const templateService = {
  getTemplates: (): TaskTemplate[] =>
    getItems<TaskTemplate>(TEMPLATES_STORAGE_KEY),
  saveTemplates: (templates: TaskTemplate[]): void =>
    saveItems<TaskTemplate>(TEMPLATES_STORAGE_KEY, templates),
};

// --- Category Service ---
export const categoryService = {
  getCategories: (): Category[] => getItems<Category>(CATEGORIES_STORAGE_KEY),
  saveCategories: (categories: Category[]): void =>
    saveItems<Category>(CATEGORIES_STORAGE_KEY, categories),
};

// MODIFIED FILE: src/services/localDataService.ts (previously taskService.ts)

const TASKS_STORAGE_KEY = "vue-time-planner-tasks";
const TEMPLATES_STORAGE_key = "vue-time-planner-templates"; // Corrected key name from original file
const CATEGORIES_STORAGE_KEY = "vue-time-planner-categories";

// A helper to get items from localStorage and parse them
function getItems<T>(key: string): T[] {
  const items = localStorage.getItem(key);
  return items ? JSON.parse(items) : [];
}

// A helper to save items to localStorage
function saveItems<T>(key: string, items: T[]): void {
  localStorage.setItem(key, JSON.stringify(items));
}

// Helper to remove an item from localStorage
function clearItems(key: string): void {
  // ADDED this helper function
  localStorage.removeItem(key);
}

// --- Task Service ---
// MODIFIED: Export changed from taskService to localTaskService
export const localTaskService = {
  getTasks: (): Task[] => getItems<Task>(TASKS_STORAGE_KEY),
  saveTasks: (tasks: Task[]): void => saveItems<Task>(TASKS_STORAGE_KEY, tasks),
  clearTasks: (): void => clearItems(TASKS_STORAGE_KEY), // ADDED clear function
};

// --- Template Service ---
// MODIFIED: Export changed from templateService to localTemplateService
export const localTemplateService = {
  getTemplates: (): TaskTemplate[] =>
    getItems<TaskTemplate>(TEMPLATES_STORAGE_key),
  saveTemplates: (templates: TaskTemplate[]): void =>
    saveItems<TaskTemplate>(TEMPLATES_STORAGE_key, templates),
  clearTemplates: (): void => clearItems(TEMPLATES_STORAGE_key), // ADDED clear function
};

// --- Category Service ---
// MODIFIED: Export changed from categoryService to localCategoryService
export const localCategoryService = {
  getCategories: (): Category[] => getItems<Category>(CATEGORIES_STORAGE_KEY),
  saveCategories: (categories: Category[]): void =>
    saveItems<Category>(CATEGORIES_STORAGE_KEY, categories),
  clearCategories: (): void => clearItems(CATEGORIES_STORAGE_KEY), // ADDED clear function
};
