// src/composables/useTasks.ts — thin view-model over the task and UI stores.

import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useTaskStore, type AddTaskOptions, type NewTaskData, type UpdateTaskOptions } from "@/stores/taskStore";
import { useUIStore } from "@/stores/uiStore";
import type { Task, TaskTemplate, Category } from "@/types";
import { addDays, isInRange, todayKey, weekDaysOf, weekRange, type DateKey } from "@/lib/datetime";

export function useTasks() {
  const uiStore = useUIStore();
  const store = useTaskStore();
  const otherCategoryId = computed(() => store.otherCategory?.id);

  const { tasks, templates, categories } = storeToRefs(store);

  /** Selected calendar date (DateKey, `YYYY-MM-DD`); the planner shows its ISO week. */
  const { currentDate } = storeToRefs(uiStore);
  const otherCategory = computed(() => store.otherCategory);

  /** The 7 DateKeys (Monday..Sunday) of the selected week. */
  const currentWeek = computed(() => weekDaysOf(currentDate.value));

  /** Half-open instant range of the selected week in the user's zone. */
  const currentWeekRange = computed(() => weekRange(currentDate.value));

  // Works for both guests (all local tasks) and authenticated users (the fetched week).
  const tasksForCurrentWeek = computed(() =>
    tasks.value.filter((task) => isInRange(task.start, currentWeekRange.value))
  );

  const nextWeek = () => {
    currentDate.value = addDays(currentDate.value, 7);
  };

  const previousWeek = () => {
    currentDate.value = addDays(currentDate.value, -7);
  };

  const nextDay = () => {
    currentDate.value = addDays(currentDate.value, 1);
  };

  const previousDay = () => {
    currentDate.value = addDays(currentDate.value, -1);
  };

  const selectDate = (day: DateKey) => {
    currentDate.value = day;
  };

  const goToToday = () => {
    currentDate.value = todayKey();
  };

  const getCategory = (id: string) => store.getCategoryById(id);

  const addTask = (task: NewTaskData, options?: AddTaskOptions): Promise<Task | null> =>
    store.addTask(task, options);

  const updateTask = (task: Task, options: boolean | UpdateTaskOptions = {}): Promise<boolean> =>
    store.updateTask(task, options);

  /** Optimistic delete with an "Undo" toast. */
  const deleteTask = (id: string): Promise<boolean> => store.deleteTask(id);

  const addCategory = (category: Omit<Category, "id">): Promise<Category | null> =>
    store.addCategory(category);
  const updateCategory = (category: Category): Promise<boolean> => store.updateCategory(category);
  const deleteCategory = (id: string): Promise<boolean> => store.deleteCategory(id);

  const addTemplate = (
    template: Omit<TaskTemplate, "id" | "categoryName" | "categoryColor">
  ): Promise<TaskTemplate | null> => store.addTemplate(template);
  const deleteTemplate = (id: string): Promise<boolean> => store.deleteTemplate(id);
  const updateTemplate = (template: TaskTemplate): Promise<boolean> => store.updateTemplate(template);

  return {
    // State
    tasks,
    templates,
    categories,
    currentWeek,
    currentWeekRange,
    tasksForCurrentWeek,
    otherCategory,
    currentDate,
    otherCategoryId,

    // Actions
    nextWeek,
    previousWeek,
    nextDay,
    previousDay,
    selectDate,
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
