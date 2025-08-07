import { defineStore } from "pinia";
import { v4 as uuidv4 } from "uuid";
import { Task, TaskTemplate, Category } from "@/types";
import {
  taskService,
  templateService,
  categoryService,
} from "@/services/taskService";
import dayjs from "dayjs";

const getInitialCategories = (): Category[] => {
  const existing = categoryService.getCategories();
  if (existing.length > 0) return existing;
  return [
    { id: "cat-1", name: "Work", color: "#4A90E2" },
    { id: "cat-2", name: "Personal", color: "#50E3C2" },
    { id: "cat-3", name: "Learning", color: "#F5A623" },
  ];
};

const getInitialTemplates = (): TaskTemplate[] => {
  const existing = templateService.getTemplates();
  if (existing.length > 0) return existing;
  return [
    { id: uuidv4(), title: "Team Meeting", duration: 1, categoryId: "cat-1" },
    { id: uuidv4(), title: "Code Review", duration: 1.5, categoryId: "cat-1" },
    { id: uuidv4(), title: "Workout", duration: 1, categoryId: "cat-2" },
    { id: uuidv4(), title: "Vue.js Study", duration: 2, categoryId: "cat-3" },
  ];
};

const getInitialTasks = (): Task[] => {
  const existing = taskService.getTasks();
  if (existing.length > 0) return existing;
  const today = dayjs();
  return [
    {
      id: uuidv4(),
      title: "Team Meeting",
      start: today.hour(9).toISOString(),
      duration: 1,
      categoryId: "cat-1",
    },
    {
      id: uuidv4(),
      title: "Vue.js Study",
      start: today.add(1, "day").hour(14).toISOString(),
      duration: 2,
      categoryId: "cat-3",
    },
  ];
};

export const useTaskStore = defineStore("tasks", {
  state: () => ({
    tasks: getInitialTasks(),
    templates: getInitialTemplates(),
    categories: getInitialCategories(),
  }),

  getters: {
    getCategoryById: (state) => (id: string) =>
      state.categories.find((c) => c.id === id),
    getTaskById: (state) => (id: string) =>
      state.tasks.find((t) => t.id === id),
  },

  actions: {
    addTask(taskData: Omit<Task, "id">) {
      const newTask: Task = { ...taskData, id: uuidv4() };
      this.tasks.push(newTask);
    },
    updateTask(updatedTask: Task) {
      const index = this.tasks.findIndex((t) => t.id === updatedTask.id);
      if (index !== -1) {
        this.tasks[index] = updatedTask;
      }
    },
    deleteTask(taskId: string) {
      this.tasks = this.tasks.filter((t) => t.id !== taskId);
    },

    addTemplate(templateData: Omit<TaskTemplate, "id">) {
      const newTemplate: TaskTemplate = { ...templateData, id: uuidv4() };
      this.templates.push(newTemplate);
    },
    deleteTemplate(templateId: string) {
      this.templates = this.templates.filter((t) => t.id !== templateId);
    },
  },
});

export function initializeTaskStore() {
  const store = useTaskStore();

  taskService.saveTasks(store.tasks);
  templateService.saveTemplates(store.templates);
  categoryService.saveCategories(store.categories);

  store.$subscribe((_mutation, state) => {
    taskService.saveTasks(state.tasks);
    templateService.saveTemplates(state.templates);
    categoryService.saveCategories(state.categories);
  });
}
