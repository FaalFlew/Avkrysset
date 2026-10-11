// src/composables/useStats.ts

import { computed, Ref, ref, watch, onMounted } from "vue"; // ADDED ref and watch
import { useTaskStore } from "@/stores/taskStore";
import { storeToRefs } from "pinia";
import dayjs from "dayjs";
import weekOfYear from "dayjs/plugin/weekOfYear";
import isoWeek from "dayjs/plugin/isoWeek";
import localizedFormat from "dayjs/plugin/localizedFormat"; // <-- Import the plugin here as well for consistency
import localeData from "dayjs/plugin/localeData"; // ✅
import { useAuthStore } from "@/stores/authStore"; // ADDED
import { Task, TaskAnalyticsResponse } from "@/types"; // MODIFIED
import { apiDataService } from "@/services/apiDataService"; // ADDED

dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);
dayjs.extend(localizedFormat); // <-- Extend dayjs here
dayjs.extend(localeData); // ✅

const DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";
const NEUTRAL_COLOR = "#A0AEC0"; // A neutral grey for bars with no dominant category

// Helper function to find the dominant category color from a map of totals.
function getDominantColor(
  totals: Record<string, number>,
  store: ReturnType<typeof useTaskStore>
): string {
  if (Object.keys(totals).length === 0) {
    return NEUTRAL_COLOR;
  }

  // Find the category ID with the most hours
  const dominantCategoryId = Object.entries(totals).reduce((a, b) =>
    b[1] > a[1] ? b : a
  )[0];

  const category = store.getCategoryById(dominantCategoryId);
  return category?.color || NEUTRAL_COLOR;
}

// Filters tasks based on the selected criteria from the UI.
function getFilteredTasks(
  allTasks: Ref<Task[]>,
  year: Ref<number>,
  view: Ref<"monthly" | "weekly" | "daily">,
  monthRange: Ref<{ start: number; end: number }>,
  weekRange: Ref<{ start: number; end: number }>,
  dailyWeek: Ref<number>
): Ref<Task[]> {
  return computed(() => {
    const selectedYear = year.value;
    return allTasks.value.filter((task) => {
      const taskDate = dayjs(task.start, DATE_FORMAT);
      if (taskDate.year() !== selectedYear) return false;

      switch (view.value) {
        case "monthly":
          const month = taskDate.month();
          return (
            month >= monthRange.value.start && month <= monthRange.value.end
          );

        case "weekly":
          const week = taskDate.isoWeek();
          return week >= weekRange.value.start && week <= weekRange.value.end;

        case "daily":
          return taskDate.isoWeek() === dailyWeek.value;

        default:
          return true;
      }
    });
  });
}

export function useStats() {
  const store = useTaskStore();
  const { tasks, templates } = storeToRefs(store);
  const authStore = useAuthStore(); // ADDED

  // Provides a list of years that have tasks, for the year selector dropdown.
  const availableYears = ref<number[]>([dayjs().year()]);
  onMounted(async () => {
    if (authStore.isAuthenticated) {
      // --- AUTHENTICATED STRATEGY ---
      // Fetch the complete list of years from our dedicated backend endpoint.
      try {
        const years = await apiDataService.getTaskYears();
        availableYears.value = years;
      } catch (error) {
        console.error("Failed to fetch available years:", error);
        // On error, we still have the fallback value.
        availableYears.value = [dayjs().year()];
      }
    } else {
      // --- GUEST STRATEGY ---
      // Use the existing logic to calculate years from localStorage tasks.
      if (tasks.value.length > 0) {
        const years = new Set(
          tasks.value.map((task) => dayjs(task.start).year())
        );
        availableYears.value = Array.from(years).sort((a, b) => b - a);
      }
    }
  });

  watch(
    tasks,
    (newTasks) => {
      if (!authStore.isAuthenticated && newTasks.length > 0) {
        const years = new Set(newTasks.map((task) => dayjs(task.start).year()));
        availableYears.value = Array.from(years).sort((a, b) => b - a);
      }
    },
    { deep: true }
  );

  // Main composable function to generate reactive stats based on filters.
  const useFilteredStats = (filters: {
    year: Ref<number>;
    view: Ref<"monthly" | "weekly" | "daily">;
    monthRange: Ref<{ start: number; end: number }>;
    weekRange: Ref<{ start: number; end: number }>;
    dailyWeek: Ref<number>;
  }) => {
    if (authStore.isAuthenticated) {
      const isLoading = ref(true);
      const analyticsData = ref<TaskAnalyticsResponse | null>(null);

      watch(
        () => [
          filters.year.value,
          filters.view.value,
          filters.monthRange.value,
          filters.weekRange.value,
          filters.dailyWeek.value,
        ],
        async () => {
          isLoading.value = true;

          let startDate: dayjs.Dayjs;
          let endDate: dayjs.Dayjs;
          const year = filters.year.value;
          const view = filters.view.value;

          switch (view) {
            case "monthly":
              // Use the selected start and end months.
              startDate = dayjs()
                .year(year)
                .month(filters.monthRange.value.start)
                .startOf("month");
              endDate = dayjs()
                .year(year)
                .month(filters.monthRange.value.end)
                .endOf("month");
              break;

            case "weekly":
              // Use the selected start and end ISO weeks.
              startDate = dayjs()
                .year(year)
                .isoWeek(filters.weekRange.value.start)
                .startOf("isoWeek");
              endDate = dayjs()
                .year(year)
                .isoWeek(filters.weekRange.value.end)
                .endOf("isoWeek");
              break;

            case "daily":
              // The "daily" view shows all days within a single selected week.
              startDate = dayjs()
                .year(year)
                .isoWeek(filters.dailyWeek.value)
                .startOf("isoWeek");
              endDate = dayjs()
                .year(year)
                .isoWeek(filters.dailyWeek.value)
                .endOf("isoWeek");
              break;
          }

          try {
            // Send the precisely calculated date range and the current view type to the API.
            analyticsData.value = await apiDataService.getTaskAnalytics(
              startDate.toISOString(),
              endDate.toISOString(),
              view
            );
          } catch (e) {
            console.error("Failed to fetch analytics", e);
            analyticsData.value = null;
          } finally {
            isLoading.value = false;
          }
        },
        { immediate: true, deep: true } // Use deep watch for monthRange/weekRange objects
      );

      const categoryDistributionChartData = computed(() => {
        if (!analyticsData.value) return { labels: [], datasets: [] };
        return {
          labels: analyticsData.value.timePerCategory.map(
            (c) => c.categoryName
          ),
          datasets: [
            {
              backgroundColor: analyticsData.value.timePerCategory.map(
                (c) => c.categoryColor
              ),
              data: analyticsData.value.timePerCategory.map(
                (c) => c.totalHours
              ),
            },
          ],
        };
      });

      const totalTimePerTemplate = computed(() => {
        if (!analyticsData.value) return [];
        return analyticsData.value.timePerTemplate.map((t) => ({
          name: t.templateTitle,
          time: t.totalHours,
          color: t.categoryColor,
        }));
      });

      const mainBreakdownChartData = computed(() => {
        if (!analyticsData.value) return { labels: [], datasets: [] };

        if (filters.view.value === "daily") {
          const startOfWeek = dayjs()
            .year(filters.year.value)
            .isoWeek(filters.dailyWeek.value)
            .startOf("isoWeek");
          const dayMap: Record<string, string> = {};
          for (let i = 0; i < 7; i++) {
            const day = startOfWeek.add(i, "day");
            dayMap[day.format("dddd")] = day.format("ddd D"); // Maps "Monday" -> "Mon 15"
          }

          const remappedData = analyticsData.value.breakdownData.map((d) => ({
            ...d,
            label: dayMap[d.label] || d.label, // Use the remapped label
          }));

          return {
            labels: remappedData.map((d) => d.label),
            datasets: [
              {
                label: "Total Hours",
                backgroundColor: remappedData.map(
                  (d) => d.dominantCategoryColor
                ),
                data: remappedData.map((d) => d.value),
              },
            ],
          };
        }
        return {
          labels: analyticsData.value.breakdownData.map((d) => d.label),
          datasets: [
            {
              label: "Total Hours",
              backgroundColor: analyticsData.value.breakdownData.map(
                (d) => d.dominantCategoryColor
              ),
              data: analyticsData.value.breakdownData.map((d) => d.value),
            },
          ],
        };
      });

      return {
        isLoading, // Expose loading state
        categoryDistributionChartData,
        totalTimePerTemplate,
        mainBreakdownChartData,
      };
    } else {
      const filteredTasks = getFilteredTasks(
        tasks,
        filters.year,
        filters.view,
        filters.monthRange,
        filters.weekRange,
        filters.dailyWeek
      );

      // Generates data for the "Time by Category" pie chart.
      const categoryDistributionChartData = computed(() => {
        const stats: Record<
          string,
          { name: string; time: number; color: string }
        > = {};
        filteredTasks.value.forEach((task) => {
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
        const data = Object.values(stats);
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

      // Generates data for the "Total Time per Task Type" table.
      const totalTimePerTemplate = computed(() => {
        const stats: Record<
          string,
          { name: string; time: number; color: string }
        > = {};
        templates.value.forEach((template) => {
          const category = store.getCategoryById(template.categoryId);
          stats[template.id] = {
            name: template.title,
            time: 0,
            color: category?.color || "#ccc",
          };
        });
        filteredTasks.value.forEach((task) => {
          if (task.templateId && stats[task.templateId]) {
            stats[task.templateId].time += task.duration;
          }
        });
        return Object.values(stats).filter((s) => s.time > 0);
      });

      const mainBreakdownChartData = computed(() => {
        const view = filters.view.value;
        const year = filters.year.value;

        switch (view) {
          case "monthly": {
            const monthlyCategoryTotals: Record<string, number>[] = Array.from(
              { length: 12 },
              () => ({})
            );
            filteredTasks.value.forEach((task) => {
              const monthIndex = dayjs(task.start, DATE_FORMAT).month();
              monthlyCategoryTotals[monthIndex][task.categoryId] =
                (monthlyCategoryTotals[monthIndex][task.categoryId] || 0) +
                task.duration;
            });

            const data = monthlyCategoryTotals.map((totals) =>
              Object.values(totals).reduce((sum, hours) => sum + hours, 0)
            );
            const colors = monthlyCategoryTotals.map((totals) =>
              getDominantColor(totals, store)
            );

            return {
              labels: dayjs.months(),
              datasets: [
                {
                  label: `Total Hours`, // Label is simpler now, as tooltip is richer
                  backgroundColor: colors,
                  data,
                  categoryTotals: monthlyCategoryTotals, // <-- ATTACH DETAILED DATA
                },
              ],
            };
          }
          case "weekly": {
            const weeklyCategoryTotals: Record<string, number>[] = Array.from(
              { length: 52 },
              () => ({})
            );
            filteredTasks.value.forEach((task) => {
              const weekIndex = dayjs(task.start, DATE_FORMAT).isoWeek() - 1;
              if (weekIndex >= 0 && weekIndex < 52) {
                weeklyCategoryTotals[weekIndex][task.categoryId] =
                  (weeklyCategoryTotals[weekIndex][task.categoryId] || 0) +
                  task.duration;
              }
            });

            const data = weeklyCategoryTotals.map((totals) =>
              Object.values(totals).reduce((sum, hours) => sum + hours, 0)
            );
            const colors = weeklyCategoryTotals.map((totals) =>
              getDominantColor(totals, store)
            );

            return {
              labels: Array.from({ length: 52 }, (_, i) => `Week ${i + 1}`),
              datasets: [
                {
                  label: `Total Hours`,
                  backgroundColor: colors,
                  data,
                  categoryTotals: weeklyCategoryTotals, // <-- ATTACH DETAILED DATA
                },
              ],
            };
          }
          case "daily": {
            const dailyCategoryTotals: Record<string, number>[] = Array.from(
              { length: 7 },
              () => ({})
            );
            const week = filters.dailyWeek.value;
            const startOfWeek = dayjs()
              .year(year)
              .isoWeek(week)
              .startOf("isoWeek");

            filteredTasks.value.forEach((task) => {
              const dayIndex = dayjs(task.start, DATE_FORMAT).isoWeekday() - 1;
              dailyCategoryTotals[dayIndex][task.categoryId] =
                (dailyCategoryTotals[dayIndex][task.categoryId] || 0) +
                task.duration;
            });

            const data = dailyCategoryTotals.map((totals) =>
              Object.values(totals).reduce((sum, hours) => sum + hours, 0)
            );
            const colors = dailyCategoryTotals.map((totals) =>
              getDominantColor(totals, store)
            );

            return {
              labels: Array.from({ length: 7 }, (_, i) =>
                startOfWeek.add(i, "day").format("ddd D")
              ),
              datasets: [
                {
                  label: `Total Hours`,
                  backgroundColor: colors,
                  data,
                  categoryTotals: dailyCategoryTotals, // <-- ATTACH DETAILED DATA
                },
              ],
            };
          }
        }
      });

      return {
        isLoading: ref(false), // Guest mode is never loading from API
        categoryDistributionChartData,
        totalTimePerTemplate,
        mainBreakdownChartData,
      };
    }
  };

  return { availableYears, useFilteredStats };
}
