// src/services/taskService.ts

import { Task, TaskTemplate, Category } from "@/types";

const TASKS_STORAGE_KEY = "vue-time-planner-tasks";
const TEMPLATES_STORAGE_KEY = "vue-time-planner-templates";
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
