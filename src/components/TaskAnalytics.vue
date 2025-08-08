<template>
  <div class="analytics-container">
    <h2>Analytics & Insights</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <h3>Time by Category</h3>
        <Pie
          v-if="categoryChartData.datasets[0].data.length > 0"
          :data="categoryChartData"
          :options="chartOptions"
        />
        <p v-else>No task data available to display chart.</p>
      </div>

      <div class="stat-card">
        <h3>Monthly Hours ({{ currentYear }})</h3>
        <Bar
          v-if="monthlyChartData.datasets[0].data.some((d) => d > 0)"
          :data="monthlyChartData"
          :options="chartOptions"
        />
        <p v-else>No task data available for {{ currentYear }}.</p>
      </div>

      <div class="stat-card full-width">
        <h3>Total Time per Task Type</h3>
        <table v-if="totalTimePerTemplate.length > 0">
          <thead>
            <tr>
              <th>Task Template</th>
              <th>Total Hours Logged</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in sortedTimePerTemplate" :key="item.name">
              <td>{{ item.name }}</td>
              <td>{{ item.time.toFixed(1) }}h</td>
            </tr>
          </tbody>
        </table>
        <p v-else>No time has been logged for any templates yet.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
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
} from "chart.js";

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement
);

const {
  categoryDistributionChartData,
  monthlyBreakdownChartData,
  totalTimePerTemplate,
} = useStats();

const currentYear = new Date().getFullYear();
const categoryChartData = computed(() => categoryDistributionChartData.value);
const monthlyChartData = computed(
  () => monthlyBreakdownChartData(currentYear).value
);

const sortedTimePerTemplate = computed(() => {
  return [...totalTimePerTemplate.value].sort((a, b) => b.time - a.time);
});

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
};
</script>

<style scoped>
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
  height: 400px;
  display: flex;
  flex-direction: column;
}
.stat-card.full-width {
  grid-column: 1 / -1;
  height: auto;
}
h3 {
  margin-top: 0;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.5rem;
  margin-bottom: 1rem;
}
p {
  text-align: center;
  color: #666;
  margin: auto;
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
</style>
