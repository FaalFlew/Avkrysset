import { computed } from "vue";
import { useTaskStore } from "@/stores/taskStore";
import { storeToRefs } from "pinia";
import dayjs from "dayjs";
import weekOfYear from "dayjs/plugin/weekOfYear";
import isoWeek from "dayjs/plugin/isoWeek";
import localizedFormat from "dayjs/plugin/localizedFormat";
import localeData from "dayjs/plugin/localeData";

dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);
dayjs.extend(localizedFormat);
dayjs.extend(localeData);

export function useStats() {
  const store = useTaskStore();
  const { tasks, templates, categories } = storeToRefs(store);

  const totalTimePerCategory = computed(() => {
    const stats: Record<string, { name: string; time: number; color: string }> =
      {};

    tasks.value.forEach((task) => {
      const category = store.getCategoryById(task.categoryId);
      if (!category) return;

      if (!stats[category.id]) {
        stats[category.id] = {
          name: category.name,
          time: 0,
          color: category.color,
        };
      }
      stats[category.id].time += task.duration;
    });

    return Object.values(stats);
  });

  const categoryDistributionChartData = computed(() => {
    const data = totalTimePerCategory.value;
    return {
      labels: data.map((d) => d.name),
      datasets: [
        {
          backgroundColor: data.map((d) => d.color),
          data: data.map((d) => d.time),
        },
      ],
    };
  });

  const monthlyBreakdownChartData = (year = dayjs().year()) =>
    computed(() => {
      const monthlyData: number[] = Array(12).fill(0);

      tasks.value.forEach((task) => {
        const taskDate = dayjs(task.start);
        if (taskDate.year() === year) {
          const monthIndex = taskDate.month();
          monthlyData[monthIndex] += task.duration;
        }
      });

      return {
        labels: dayjs.months(),
        datasets: [
          {
            label: `Total Hours in ${year}`,
            backgroundColor: "#4A90E2",
            data: monthlyData,
          },
        ],
      };
    });

  const totalTimePerTemplate = computed(() => {
    const stats: Record<string, { name: string; time: number }> = {};

    templates.value.forEach((template) => {
      stats[template.id] = { name: template.title, time: 0 };
    });

    tasks.value.forEach((task) => {
      if (task.templateId && stats[task.templateId]) {
        stats[task.templateId].time += task.duration;
      }
    });

    return Object.values(stats).filter((s) => s.time > 0);
  });

  return {
    totalTimePerCategory,
    categoryDistributionChartData,
    monthlyBreakdownChartData,
    totalTimePerTemplate,
  };
}
