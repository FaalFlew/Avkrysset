// src/stores/taskStore.ts

import { defineStore } from "pinia";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import { useUIStore } from "./uiStore";
import {
  taskService,
  templateService,
  categoryService,
} from "@/services/localDataService";
import { Task, TaskTemplate, Category, MigrationData } from "@/types"; // ADDED MigrationData
import { apiDataService } from "@/services/apiDataService"; // ADDED
import { useAuthStore } from "./authStore"; // ADDED
import {
  localTaskService,
  localTemplateService,
  localCategoryService,
} from "@/services/localDataService";

dayjs.extend(isBetween);

const isOverlapping = (
  taskA: Omit<Task, "id" | "categoryName" | "categoryColor">,
  taskB: Task
): boolean => {
  const startA = dayjs(taskA.start);
  const endA = startA.add(taskA.duration, "hour");
  const startB = dayjs(taskB.start);
  const endB = startB.add(taskB.duration, "hour");
  return startA.isBefore(endB) && startB.isBefore(endA);
};

export const useTaskStore = defineStore("tasks", {
  // MODIFICATION: State is now initialized as empty. It will be populated by our new initialize action.

  state: () => ({
    tasks: [] as Task[],
    templates: [] as TaskTemplate[],
    categories: [] as Category[],
    todayTasks: [] as Task[],
    isLoading: true, // ADDED: Loading state for better UX
  }),

  getters: {
    getCategoryById: (state) => (id: string) =>
      state.categories.find((c) => c.id === id),
    getTaskById: (state) => (id: string) =>
      state.tasks.find((t) => t.id === id),
    otherCategory: (state) => state.categories.find((c) => c.name === "Other"),
  },

  actions: {
    // --- NEW MASTER INITIALIZATION ACTION ---
    async initializeData() {
      this.isLoading = true;
      const authStore = useAuthStore();
      const uiStore = useUIStore();

      try {
        if (authStore.isAuthenticated) {
          // User is logged in, fetch data from the API
          const [categories, templates] = await Promise.all([
            apiDataService.getCategories(),
            apiDataService.getTaskTemplates(),
            // Tasks will be fetched on-demand by the WeekView component
          ]);
          this.categories = categories;
          this.templates = templates;
          this.tasks = []; // Reset tasks, they will be fetched by date range
        } else {
          // User is a guest, load data from localStorage
          this.categories = localCategoryService.getCategories();
          this.templates = localTemplateService.getTemplates();
          this.tasks = localTaskService.getTasks();

          // Ensure the default "Other" category exists for guests
          if (!this.categories.find((c) => c.name === "Other")) {
            const otherCategory = {
              id: uuidv4(),
              name: "Other",
              color: "#8B949E",
            };
            this.categories.unshift(otherCategory); // Add to the start
          }
        }
      } catch (error) {
        console.error("Failed to initialize data:", error);
        uiStore.showToast(
          "Could not load your data. Please try again later.",
          "error"
        );
      } finally {
        this.isLoading = false;
      }
    },

    // --- NEW ACTION to fetch tasks for a specific date range ---
    async fetchTasksForRange(startDate: string, endDate: string) {
      const authStore = useAuthStore();
      if (!authStore.isAuthenticated) return; // Only for logged-in users

      this.isLoading = true;
      try {
        const tasks = await apiDataService.getTasks(startDate, endDate);
        // Replace the current tasks with the fetched ones.
        // A more advanced implementation might merge them, but for a simple week view, replacing is fine.
        this.tasks = tasks;
      } catch (error) {
        console.error("Failed to fetch tasks:", error);
        useUIStore().showToast("Could not load tasks for this week.", "error");
      } finally {
        this.isLoading = false;
      }
    },

    // --- NEW ACTION for data migration ---
    getLocalDataForMigration(): MigrationData {
      // This helper function will be called during registration
      const categories = localCategoryService.getCategories();
      const templates = localTemplateService.getTemplates();
      const tasks = localTaskService.getTasks();

      // The backend DTOs expect specific fields, so we map them just in case.
      // This also filters out the default "Other" category from migration.
      const mapCategory = (c: Category) => ({
        id: c.id,
        name: c.name,
        color: c.color,
      });
      const mapTemplate = (t: TaskTemplate) => ({
        id: t.id,
        title: t.title,
        duration: t.duration,
        categoryId: t.categoryId,
      });
      const mapTask = (t: Task) => ({
        title: t.title,
        start: t.start,
        duration: t.duration,
        categoryId: t.categoryId,
        templateId: t.templateId,
      });

      return {
        categories: categories
          .filter((c) => c.name !== "Other")
          .map(mapCategory),
        templates: templates.map(mapTemplate),
        tasks: tasks.map(mapTask),
      };
    },

    // --- NEW ACTION to clear local data after migration ---
    clearLocalData() {
      localTaskService.clearTasks();
      localTemplateService.clearTemplates();
      localCategoryService.clearCategories();
      // Also clear the store's state
      this.tasks = [];
      this.templates = [];
      this.categories = [];
    },

    // --- REIMPLEMENTED CATEGORY ACTIONS ---
    async addCategory(
      categoryData: Omit<Category, "id">
    ): Promise<Category | null> {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      try {
        if (authStore.isAuthenticated) {
          const newCategory = await apiDataService.createCategory(categoryData);
          this.categories.push(newCategory);
          uiStore.showToast("Category created!", "success");
          return newCategory;
        } else {
          const newCategory: Category = { ...categoryData, id: uuidv4() };
          this.categories.push(newCategory);
          uiStore.showToast("Category created!", "success");
          return newCategory;
        }
      } catch (error) {
        uiStore.showToast("Failed to create category.", "error");
        console.error(error);
        return null;
      }
    },

    async updateCategory(updatedCategory: Category) {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const index = this.categories.findIndex(
        (c) => c.id === updatedCategory.id
      );
      if (index === -1) return;

      try {
        if (authStore.isAuthenticated) {
          await apiDataService.updateCategory(updatedCategory.id, {
            name: updatedCategory.name,
            color: updatedCategory.color,
          });
        }
        this.categories[index] = updatedCategory;
        uiStore.showToast("Category updated!", "success");
      } catch (error) {
        uiStore.showToast("Failed to update category.", "error");
        console.error(error);
      }
    },

    async deleteCategory(categoryId: string) {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const otherCat = this.otherCategory;

      if (!otherCat || categoryId === otherCat.id) {
        uiStore.showToast(
          "The default 'Other' category cannot be deleted.",
          "error"
        );
        return;
      }

      try {
        if (authStore.isAuthenticated) {
          await apiDataService.deleteCategory(categoryId);
          // For auth users, the backend handles re-assigning. We just need to refresh the data.
          // A simple way is to re-fetch, a more optimized way would be to update locally.
          // For now, let's re-fetch for simplicity and data consistency.
          this.templates = await apiDataService.getTaskTemplates();
          // We can't just re-fetch tasks as it would wipe out the current view.
          // The backend ensures tasks are reassigned, so we just need to update the UI.
          this.tasks.forEach((task) => {
            if (task.categoryId === categoryId) {
              task.categoryId = otherCat.id;
              task.categoryName = otherCat.name;
              task.categoryColor = otherCat.color;
            }
          });
        } else {
          // Guest mode: Manually re-assign tasks and templates
          this.tasks.forEach((task) => {
            if (task.categoryId === categoryId) task.categoryId = otherCat.id;
          });
          this.templates.forEach((template) => {
            if (template.categoryId === categoryId)
              template.categoryId = otherCat.id;
          });
        }

        this.categories = this.categories.filter((c) => c.id !== categoryId);
        uiStore.showToast(
          "Category deleted. Associated items moved to 'Other'.",
          "info"
        );
      } catch (error) {
        uiStore.showToast("Failed to delete category.", "error");
        console.error(error);
      }
    },

    // --- REIMPLEMENTED TASK ACTIONS ---
    async addTask(
      taskData: Omit<Task, "id" | "categoryName" | "categoryColor">
    ): Promise<boolean> {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const category = this.getCategoryById(taskData.categoryId);
      if (!category) {
        uiStore.showToast("Invalid category selected.", "error");
        return false;
      }

      if (authStore.isAuthenticated) {
        try {
          const newTask = await apiDataService.createTask(taskData);
          this.tasks.push(newTask);
          uiStore.showToast("Task created successfully!", "success");
          return true;
        } catch (error: any) {
          const message =
            error.response?.data?.message || "Failed to create task.";
          uiStore.showToast(message, "error");
          return false;
        }
      } else {
        // Guest mode overlap check
        for (const existingTask of this.tasks) {
          if (isOverlapping(taskData, existingTask)) {
            uiStore.showToast(
              "Error: This time slot overlaps with an existing task.",
              "error"
            );
            return false;
          }
        }
        const newTask: Task = {
          ...taskData,
          id: uuidv4(),
          categoryName: category.name,
          categoryColor: category.color,
        };
        this.tasks.push(newTask);
        uiStore.showToast("Task created successfully!", "success");
        return true;
      }
    },

    async updateTask(
      updatedTask: Task,
      silent: boolean = false
    ): Promise<boolean> {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const index = this.tasks.findIndex((t) => t.id === updatedTask.id);
      if (index === -1) return false;

      const taskDataForApi = {
        title: updatedTask.title,
        start: updatedTask.start,
        duration: updatedTask.duration,
        categoryId: updatedTask.categoryId,
        templateId: updatedTask.templateId,
      };

      if (authStore.isAuthenticated) {
        try {
          await apiDataService.updateTask(updatedTask.id, taskDataForApi);
          // The API call succeeded, now update local state
          this.tasks[index] = updatedTask;
          if (!silent) uiStore.showToast("Task updated!", "success");
          return true;
        } catch (error: any) {
          const message =
            error.response?.data?.message || "Failed to update task.";
          if (!silent) uiStore.showToast(message, "error");
          return false;
        }
      } else {
        // Guest mode overlap check
        for (const existingTask of this.tasks) {
          if (
            existingTask.id !== updatedTask.id &&
            isOverlapping(taskDataForApi, existingTask)
          ) {
            if (!silent)
              uiStore.showToast(
                "Error: This time slot overlaps with an existing task.",
                "error"
              );
            return false;
          }
        }
        this.tasks[index] = updatedTask;
        if (!silent) uiStore.showToast("Task updated!", "success");
        return true;
      }
    },

    async deleteTask(taskId: string) {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      try {
        if (authStore.isAuthenticated) {
          await apiDataService.deleteTask(taskId);
        }
        this.tasks = this.tasks.filter((t) => t.id !== taskId);
        uiStore.showToast("Task deleted.", "info");
      } catch (error) {
        uiStore.showToast("Failed to delete task.", "error");
        console.error(error);
      }
    },

    // --- REIMPLEMENTED TEMPLATE ACTIONS (abbreviated for clarity, same pattern) ---
    async addTemplate(
      templateData: Omit<TaskTemplate, "id" | "categoryName" | "categoryColor">
    ) {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const category = this.getCategoryById(templateData.categoryId);

      if (!category) {
        uiStore.showToast("Invalid category selected for template.", "error");
        return;
      }

      if (authStore.isAuthenticated) {
        try {
          // AUTHENTICATED: Call the API
          const newTemplate = await apiDataService.createTaskTemplate(
            templateData
          );
          this.templates.push(newTemplate);
          uiStore.showToast("Template created successfully!", "success");
        } catch (error) {
          console.error("Failed to create template:", error);
          uiStore.showToast(
            "Could not create the template on the server.",
            "error"
          );
        }
      } else {
        // GUEST: Manipulate local state
        const newTemplate: TaskTemplate = {
          ...templateData,
          id: uuidv4(),
          categoryName: category.name,
          categoryColor: category.color,
        };
        this.templates.push(newTemplate);
        uiStore.showToast("Template created successfully!", "success");
      }
    },

    async deleteTemplate(templateId: string) {
      const authStore = useAuthStore();
      const uiStore = useUIStore();

      if (authStore.isAuthenticated) {
        try {
          // AUTHENTICATED: Call the API
          await apiDataService.deleteTaskTemplate(templateId);
          // If successful, remove from local state
          this.templates = this.templates.filter((t) => t.id !== templateId);
          uiStore.showToast("Template deleted.", "info");
        } catch (error) {
          console.error("Failed to delete template:", error);
          uiStore.showToast(
            "Could not delete the template on the server.",
            "error"
          );
        }
      } else {
        // GUEST: Manipulate local state
        this.templates = this.templates.filter((t) => t.id !== templateId);
        uiStore.showToast("Template deleted.", "info");
      }
    },

    // ADDED: updateTemplate for completeness.
    // The UI doesn't have an "edit template" feature yet, but the store should support it.
    async updateTemplate(updatedTemplate: TaskTemplate) {
      const authStore = useAuthStore();
      const uiStore = useUIStore();
      const index = this.templates.findIndex(
        (t) => t.id === updatedTemplate.id
      );
      if (index === -1) return;

      const templateDataForApi = {
        title: updatedTemplate.title,
        duration: updatedTemplate.duration,
        categoryId: updatedTemplate.categoryId,
      };

      if (authStore.isAuthenticated) {
        try {
          await apiDataService.updateTaskTemplate(
            updatedTemplate.id,
            templateDataForApi
          );
          this.templates[index] = updatedTemplate;
          uiStore.showToast("Template updated!", "success");
        } catch (error) {
          console.error("Failed to update template:", error);
          uiStore.showToast(
            "Could not update the template on the server.",
            "error"
          );
        }
      } else {
        // GUEST:
        this.templates[index] = updatedTemplate;
        uiStore.showToast("Template updated!", "success");
      }
    },

    async fetchTodayTasks() {
      this.isLoading = true;
      const authStore = useAuthStore();

      try {
        if (authStore.isAuthenticated) {
          // AUTHENTICATED: Fetch today's tasks from the API.
          this.todayTasks = await apiDataService.getTasksForDay(dayjs());
        } else {
          // GUEST: Filter the main tasks list from localStorage.
          const todayStart = dayjs().startOf("day");
          const todayEnd = dayjs().endOf("day");
          this.todayTasks = this.tasks.filter((task) =>
            dayjs(task.start).isBetween(todayStart, todayEnd, null, "[]")
          );
        }
      } catch (error) {
        console.error("Failed to fetch today's tasks:", error);
        useUIStore().showToast("Could not load today's tasks.", "error");
        this.todayTasks = []; // Clear on error
      } finally {
        this.isLoading = false;
      }
    },
  },
  // ADDED: A way to connect the store to localStorage for guests
  // This is a more advanced Pinia pattern that replaces the old $subscribe logic
  // and keeps it neatly inside the store definition.
  hydrate(state, initialState) {
    const authStore = useAuthStore();
    // Only hydrate (load from local) if the user is a guest
    if (!authStore.isAuthenticated) {
      state.categories = localCategoryService.getCategories();
      state.templates = localTemplateService.getTemplates();
      state.tasks = localTaskService.getTasks();
    }
  },
});

// A separate function to watch for guest-mode changes and save them
export function setupTaskStoreSubscribers() {
  const taskStore = useTaskStore();
  const authStore = useAuthStore();

  taskStore.$subscribe((_mutation, state) => {
    // Only save to localStorage if the user is a guest.
    if (!authStore.isAuthenticated) {
      localTaskService.saveTasks(state.tasks);
      localTemplateService.saveTemplates(state.templates);
      localCategoryService.saveCategories(state.categories);
    }
  });
}
