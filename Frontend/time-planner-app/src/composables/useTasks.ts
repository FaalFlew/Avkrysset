// src/composables/useTasks.ts

import { ref, computed, watchEffect } from "vue";
import { useTaskStore } from "@/stores/taskStore";
import { storeToRefs } from "pinia";
import dayjs, { Dayjs } from "dayjs";
import weekOfYear from "dayjs/plugin/weekOfYear";
import isoWeek from "dayjs/plugin/isoWeek";
import isBetween from "dayjs/plugin/isBetween";
import { Task, TaskTemplate, Category } from "@/types"; // ADDED Types for clarity
import { useAuthStore } from "@/stores/authStore"; // ADDED
import { useUIStore } from "@/stores/uiStore"; // ADDED: Import uiStore

dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);
dayjs.extend(isBetween);
// Define the format here to ensure consistency
const DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";

export function useTasks() {
  const uiStore = useUIStore();
  const store = useTaskStore();
  const authStore = useAuthStore(); // ADDED: Get a reference to the auth store
  const otherCategoryId = computed(() => store.otherCategory?.id);

  const { tasks, templates, categories } = storeToRefs(store);

  const { currentDate } = storeToRefs(uiStore);
  const otherCategory = computed(() => store.otherCategory);

  const currentDateAsDayjs = computed(() => dayjs(currentDate.value));

  const currentWeek = computed(() => {
    const startOfWeek = currentDateAsDayjs.value.startOf("isoWeek");
    return Array.from({ length: 7 }, (_, i) => startOfWeek.add(i, "day"));
  });
  /*
  // --- ADDED: The core fix is this watchEffect ---
  watch(async () => {
    // This function will re-run automatically whenever currentWeek changes.

    // 1. Check if the user is logged in. Guests don't need to fetch.
    if (authStore.isAuthenticated) {
      const week = currentWeek.value;
      if (!week || week.length === 0) return; // Add a guard for initial state

      const startDate = week[0].startOf("day").toISOString();
      const endDate = week[6].endOf("day").toISOString();

      // 2. Trigger the action in the store to fetch tasks from the API.
      await store.fetchTasksForRange(startDate, endDate);
    }
  });*/

  // This computed property now correctly works for both guests (filtering local data)
  // and authenticated users (filtering the freshly fetched API data).
  const tasksForCurrentWeek = computed(() => {
    const start = currentWeek.value[0].startOf("day");
    const end = currentWeek.value[6].endOf("day");
    return tasks.value.filter((task) =>
      dayjs(task.start).isBetween(start, end, null, "[]")
    );
  });

  // --- MODIFICATION: Update navigation functions to mutate the store ---
  const nextWeek = () => {
    // Mutate the string in the store
    currentDate.value = currentDateAsDayjs.value.add(1, "week").toISOString();
  };

  const previousWeek = () => {
    // Mutate the string in the store
    currentDate.value = currentDateAsDayjs.value
      .subtract(1, "week")
      .toISOString();
  };

  const goToToday = () => {
    // Mutate the string in the store
    currentDate.value = dayjs().toISOString();
  };

  const getCategory = (id: string) => store.getCategoryById(id);

  //
  const addTask = async (
    task: Omit<Task, "id" | "categoryName" | "categoryColor">
  ): Promise<boolean> => {
    return await store.addTask(task);
  };

  const updateTask = async (
    task: Task,
    silent: boolean = false
  ): Promise<boolean> => {
    return await store.updateTask(task, silent);
  };

  const deleteTask = async (id: string) => await store.deleteTask(id);

  // ... other actions updated similarly to be async ...
  const addCategory = async (
    category: Omit<Category, "id">
  ): Promise<Category | null> => {
    return await store.addCategory(category);
  };
  const updateCategory = async (category: Category) =>
    await store.updateCategory(category);
  const deleteCategory = async (id: string) => await store.deleteCategory(id);

  //

  const addTemplate = async (
    template: Omit<TaskTemplate, "id" | "categoryName" | "categoryColor">
  ) => {
    await store.addTemplate(template);
  };
  const deleteTemplate = async (id: string) => {
    await store.deleteTemplate(id);
  };
  const updateTemplate = async (template: TaskTemplate) => {
    await store.updateTemplate(template);
  };

  return {
    // State
    tasks,
    templates,
    categories,
    currentWeek,
    tasksForCurrentWeek,
    otherCategory,
    currentDate: currentDateAsDayjs,
    otherCategoryId,

    // Actions
    nextWeek,
    previousWeek,
    goToToday,
    getCategory,
    addTask,
    updateTask,
    deleteTask,
    addTemplate,
    deleteTemplate,
    updateTemplate,
    addCategory,
    updateCategory,
    deleteCategory,
  };
}
