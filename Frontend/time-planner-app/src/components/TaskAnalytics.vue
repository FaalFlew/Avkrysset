<!-- src/components/TaskAnalytics.vue -->
<template>
  <div v-if="isLoading" class="loading-overlay">
    <p>Loading Analytics...</p>
  </div>
  <div v-else class="analytics-container">
    <h2>Analytics & Insights</h2>
    <div class="stats-grid">
      <!-- Filters Card -->
      <div class="stat-card filters-card">
        <h3>Filters</h3>
        <div class="form-group">
          <label for="year-select">Year</label>
          <select id="year-select" v-model="selectedYear">
            <option v-for="year in availableYears" :key="year" :value="year">
              {{ year }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label>View Type</label>
          <div class="btn-group">
            <button
              @click="selectedView = 'monthly'"
              :class="{ active: selectedView === 'monthly' }"
            >
              Monthly
            </button>
            <button
              @click="selectedView = 'weekly'"
              :class="{ active: selectedView === 'weekly' }"
            >
              Weekly
            </button>
            <button
              @click="selectedView = 'daily'"
              :class="{ active: selectedView === 'daily' }"
            >
              Daily
            </button>
          </div>
        </div>

        <div v-if="selectedView === 'monthly'" class="range-selector">
          <div class="form-group">
            <label>Start Month</label>
            <select v-model="monthRange.start">
              <option
                v-for="(month, i) in dayjs.months()"
                :key="i"
                :value="i"
                :disabled="i > monthRange.end"
              >
                {{ month }}
              </option>
            </select>
          </div>
          <div class="form-group">
            <label>End Month</label>
            <select v-model="monthRange.end">
              <option
                v-for="(month, i) in dayjs.months()"
                :key="i"
                :value="i"
                :disabled="i < monthRange.start"
              >
                {{ month }}
              </option>
            </select>
          </div>
        </div>

        <div v-if="selectedView === 'weekly'" class="range-selector">
          <div class="form-group">
            <label>Start Week</label>
            <select v-model="weekRange.start">
              <option
                v-for="w in 52"
                :key="w"
                :value="w"
                :disabled="w > weekRange.end"
              >
                Week {{ w }}
              </option>
            </select>
          </div>
          <div class="form-group">
            <label>End Week</label>
            <select v-model="weekRange.end">
              <option
                v-for="w in 52"
                :key="w"
                :value="w"
                :disabled="w < weekRange.start"
              >
                Week {{ w }}
              </option>
            </select>
          </div>
        </div>

        <div v-if="selectedView === 'daily'" class="form-group">
          <label for="week-select">Week of Year</label>
          <select id="week-select" v-model="dailyWeek">
            <option v-for="week in 52" :key="week" :value="week">
              Week {{ week }} ({{ getWeekDateRange(week) }})
            </option>
          </select>
        </div>
      </div>

      <!-- Time by Category Chart -->
      <div class="stat-card">
        <h3>Time by Category</h3>
        <p class="chart-hint">{{ dynamicHint }}</p>
        <div class="chart-container">
          <Pie
            v-if="filteredCategoryData.datasets[0].data.length > 0"
            :data="filteredCategoryData"
            :options="chartOptions"
          />
          <p v-else>No task data for this period.</p>
        </div>
      </div>

      <!-- Main Time Breakdown Chart -->
      <div class="stat-card full-width">
        <h3 v-if="selectedView === 'monthly'">
          Monthly Hours ({{ selectedYear }})
        </h3>
        <h3 v-if="selectedView === 'weekly'">
          Weekly Hours ({{ selectedYear }})
        </h3>
        <h3 v-if="selectedView === 'daily'">
          Daily Hours for Week {{ dailyWeek }}, {{ selectedYear }}
        </h3>

        <div class="chart-container">
          <Bar
            v-if="mainBreakdownChartData.datasets[0].data.some((d) => d > 0)"
            :data="mainBreakdownChartData"
            :options="barChartOptions"
          />
          <p v-else>No task data available for this view.</p>
        </div>
      </div>

      <!-- Total Time Per Template Table -->
      <div class="stat-card full-width">
        <h3>Total Time per Task Type</h3>
        <p class="chart-hint">{{ dynamicHint }}</p>
        <table v-if="sortedTimePerTemplate.length > 0">
          <thead>
            <tr>
              <th>Task Template</th>
              <th>Total Hours Logged</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in sortedTimePerTemplate" :key="item.name">
              <td>
                <span class="template-cell">
                  <span
                    class="color-bar"
                    :style="{ backgroundColor: item.color }"
                  ></span>
                  {{ item.name }}
                </span>
              </td>
              <td>{{ item.time.toFixed(1) }}h</td>
            </tr>
          </tbody>
        </table>
        <p v-else>No task data for this period.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useStats } from "@/composables/useStats";
import { Bar, Pie } from "vue-chartjs";
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement,
  TooltipItem,
} from "chart.js"; // <-- Import TooltipItem
import dayjs from "dayjs";
import weekOfYear from "dayjs/plugin/weekOfYear";
import isoWeek from "dayjs/plugin/isoWeek";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { useTaskStore } from "@/stores/taskStore"; // <-- Import task store for category names

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement
);
dayjs.extend(weekOfYear);
dayjs.extend(isoWeek);
dayjs.extend(localizedFormat);
const { availableYears, useFilteredStats } = useStats();
const taskStore = useTaskStore(); // <-- FIX: Instantiate the store here

const selectedYear = ref(availableYears.value[0] || dayjs().year());
const selectedView = ref<"monthly" | "weekly" | "daily">("monthly");
const dailyWeek = ref(dayjs().isoWeek());
const monthRange = ref({ start: 0, end: 11 });
const weekRange = ref({ start: 1, end: 52 });

const {
  categoryDistributionChartData: filteredCategoryData,
  totalTimePerTemplate: filteredTemplateData,
  mainBreakdownChartData,
  isLoading,
} = useFilteredStats({
  year: selectedYear,
  view: selectedView,
  monthRange: monthRange,
  weekRange: weekRange,
  dailyWeek: dailyWeek,
});

const sortedTimePerTemplate = computed(() =>
  [...filteredTemplateData.value].sort((a, b) => b.time - a.time)
);

const dynamicHint = computed(() => {
  switch (selectedView.value) {
    case "monthly":
      return `Showing data for months ${
        dayjs.monthsShort()[monthRange.value.start]
      } - ${dayjs.monthsShort()[monthRange.value.end]} of ${
        selectedYear.value
      }`;
    case "weekly":
      return `Showing data for weeks ${weekRange.value.start} - ${weekRange.value.end} of ${selectedYear.value}`;
    case "daily":
      return `Showing data for week ${dailyWeek.value} of ${selectedYear.value}`;
  }
});

// --- NEW: Custom Chart Options with Tooltip Callback ---
const barChartOptions = computed(() => {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          // The 'footer' callback adds extra lines to the tooltip
          footer: (tooltipItems: TooltipItem<"bar">[]) => {
            const tooltipItem = tooltipItems[0];
            if (!tooltipItem) return "";

            // Retrieve our custom data from the dataset
            // @ts-ignore - a necessary evil as chart.js types don't know about our custom property
            const categoryTotals = (tooltipItem.dataset as any).categoryTotals[
              tooltipItem.dataIndex
            ];

            if (!categoryTotals || Object.keys(categoryTotals).length === 0) {
              return "No category data.";
            }

            // Format the breakdown into an array of strings
            const breakdown = Object.entries(categoryTotals)
              .map(([categoryId, hours]) => {
                const category = taskStore.getCategoryById(categoryId);
                return {
                  name: category?.name || "Unknown",
                  hours: hours as number,
                };
              })
              .sort((a, b) => b.hours - a.hours) // Sort with largest first
              .map((item) => `${item.name}: ${item.hours.toFixed(1)}h`);

            return breakdown;
          },
        },
      },
    },
  };
});

// Pie chart options can remain simple
const chartOptions = { responsive: true, maintainAspectRatio: false };
const getWeekDateRange = (weekNum: number) => {
  const start = dayjs()
    .year(selectedYear.value)
    .isoWeek(weekNum)
    .startOf("isoWeek")
    .format("MMM D");
  const end = dayjs()
    .year(selectedYear.value)
    .isoWeek(weekNum)
    .endOf("isoWeek")
    .format("MMM D");
  return `${start} - ${end}`;
};
</script>
<style scoped>
/* ADD styles for the loading state */
.loading-overlay {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 300px;
  font-size: 1.5rem;
  color: #777;
}
.analytics-container {
  padding: 2rem;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
  gap: 2rem;
  margin-top: 1rem;
}

.stat-card {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
}
.stat-card.full-width {
  grid-column: 1 / -1;
}

.stat-card h3 {
  margin-top: 0;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.5rem;
  margin-bottom: 1rem;
}
.stat-card p {
  text-align: center;
  color: #666;
  margin: auto;
}

.chart-container {
  position: relative;
  height: 350px;
  flex-grow: 1;
}

table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 0.75rem;
  text-align: left;
  border-bottom: 1px solid #eee;
}
th {
  background-color: #f8f8f8;
}

/* --- NEW STYLES FOR THE COLOR BAR --- */
.template-cell {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.color-bar {
  display: inline-block;
  width: 4px;
  height: 1.2rem;
  border-radius: 2px;
}

/* Filter Styles */
.filters-card h3 {
  margin-bottom: 1.5rem;
}
.form-group {
  margin-bottom: 1rem;
}
.form-group:last-child {
  margin-bottom: 0;
}
.btn-group {
  display: flex;
  width: 100%;
}
.btn-group button {
  flex-grow: 1;
  background-color: #f0f0f0;
  border: 1px solid #ccc;
  padding: 0.75rem;
  cursor: pointer;
  transition: background-color 0.2s;
}
.btn-group button:first-child {
  border-radius: 4px 0 0 4px;
}
.btn-group button:nth-child(2) {
  border-left: none;
}
.btn-group button:last-child {
  border-radius: 0 4px 4px 0;
  border-left: none;
}
.btn-group button.active {
  background-color: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}
.range-selector {
  display: flex;
  gap: 1rem;
}
.range-selector .form-group {
  flex: 1;
}
.chart-hint {
  font-size: 0.8rem;
  text-align: center;
  color: #888;
  margin: -0.5rem 0 0.5rem;
  padding: 0;
}
</style>
