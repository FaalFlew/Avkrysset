<!-- NEW FILE: src/views/TodayView.vue -->
<script setup lang="ts">
import { onMounted, computed } from "vue";
import { useTaskStore } from "@/stores/taskStore";
import { storeToRefs } from "pinia";
import dayjs from "dayjs";
import { RouterLink } from "vue-router";

const taskStore = useTaskStore();
// Get reactive references to the new state property and loading status
const { todayTasks, isLoading } = storeToRefs(taskStore);

// Fetch the data when the component is first mounted
onMounted(() => {
  taskStore.fetchTodayTasks();
});

// Sort tasks by their start time for a clean, chronological view
const sortedTasks = computed(() => {
  return [...todayTasks.value].sort((a, b) =>
    dayjs(a.start).diff(dayjs(b.start))
  );
});

// Helper to format the time range for display
const formatTimeRange = (start: string, duration: number) => {
  const startTime = dayjs(start);
  const endTime = startTime.add(duration, "hour");
  return `${startTime.format("HH:mm")} - ${endTime.format("HH:mm")}`;
};
</script>

<template>
  <div class="today-view">
    <header class="today-header">
      <h1>Today's Agenda</h1>
      <p>{{ dayjs().format("dddd, MMMM D") }}</p>
    </header>

    <div v-if="isLoading" class="loading-indicator">
      <p>Loading tasks...</p>
    </div>

    <div v-else-if="sortedTasks.length > 0" class="task-list">
      <div v-for="task in sortedTasks" :key="task.id" class="task-item">
        <div
          class="color-bar"
          :style="{ backgroundColor: task.categoryColor }"
        ></div>
        <div class="task-details">
          <span class="task-time">{{
            formatTimeRange(task.start, task.duration)
          }}</span>
          <h3 class="task-title">{{ task.title }}</h3>
          <span class="task-category">{{ task.categoryName }}</span>
        </div>
      </div>
    </div>

    <div v-else class="no-tasks-message">
      <h2>No tasks scheduled for today.</h2>
      <p>
        Enjoy your day, or <RouterLink to="/">go to the planner</RouterLink> to
        add some.
      </p>
    </div>
  </div>
</template>

<style scoped>
.today-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 1rem 2rem;
}
.today-header {
  border-bottom: 2px solid #e0e0e0;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
}
.today-header h1 {
  margin: 0;
}
.today-header p {
  margin: 0;
  color: #555;
  font-size: 1.1rem;
}
.loading-indicator {
  text-align: center;
  padding: 3rem;
  color: #777;
}
.task-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.task-item {
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  transition: transform 0.2s ease-in-out;
}
.task-item:hover {
  transform: translateY(-2px);
}
.color-bar {
  width: 8px;
  align-self: stretch;
}
.task-details {
  padding: 1rem 1.5rem;
  flex-grow: 1;
}
.task-time {
  font-weight: 500;
  color: var(--primary-color);
  font-size: 0.9rem;
  display: block;
  margin-bottom: 0.25rem;
}
.task-title {
  margin: 0 0 0.25rem 0;
  font-size: 1.2rem;
}
.task-category {
  font-size: 0.9rem;
  color: #777;
}
.no-tasks-message {
  text-align: center;
  padding: 4rem 2rem;
  background-color: #f9f9f9;
  border-radius: 8px;
  margin-top: 2rem;
}
</style>
