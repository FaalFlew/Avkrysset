import { ref, computed } from "vue";
import { useTaskStore } from "@/stores/taskStore";
import { storeToRefs } from "pinia";
import dayjs, { Dayjs } from "dayjs";
import weekOfYear from "dayjs/plugin/weekOfYear";
import isoWeek from "dayjs/plugin/isoWeek";
import { TaskTemplate, Task } from "@/types";

dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);

export function useTasks() {
  const store = useTaskStore();
  const { tasks, templates, categories } = storeToRefs(store);

  const currentDate = ref(dayjs());

  const currentWeek = computed(() => {
    const startOfWeek = currentDate.value.startOf("isoWeek");
    return Array.from({ length: 7 }, (_, i) => startOfWeek.add(i, "day"));
  });

  const tasksForCurrentWeek = computed(() => {
    const start = currentWeek.value[0].startOf("day");
    const end = currentWeek.value[6].endOf("day");
    return tasks.value.filter((task) =>
      dayjs(task.start).isBetween(start, end, null, "[]")
    );
  });

  const nextWeek = () => {
    currentDate.value = currentDate.value.add(1, "week");
  };

  const previousWeek = () => {
    currentDate.value = currentDate.value.subtract(1, "week");
  };

  const goToToday = () => {
    currentDate.value = dayjs();
  };

  const createTaskFromTemplate = (
    template: TaskTemplate,
    date: Dayjs,
    startTime: string
  ) => {
    const [hour, minute] = startTime.split(":").map(Number);
    const startDateTime = date.hour(hour).minute(minute).second(0);

    const taskData: Omit<Task, "id"> = {
      ...template,
      start: startDateTime.toISOString(),
      templateId: template.id,
    };
    store.addTask(taskData);
  };

  const getCategory = (id: string) => store.getCategoryById(id);
  const addTask = (task: Omit<Task, "id">) => store.addTask(task);
  const updateTask = (task: Task) => store.updateTask(task);
  const deleteTask = (id: string) => store.deleteTask(id);
  const addTemplate = (template: Omit<TaskTemplate, "id">) =>
    store.addTemplate(template);
  const deleteTemplate = (id: string) => store.deleteTemplate(id);

  return {
    tasks,
    templates,
    categories,
    currentDate,
    currentWeek,
    tasksForCurrentWeek,

    nextWeek,
    previousWeek,
    goToToday,
    createTaskFromTemplate,
    getCategory,
    addTask,
    updateTask,
    deleteTask,
    addTemplate,
    deleteTemplate,
  };
}
