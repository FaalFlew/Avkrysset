<!-- MODIFIED FILE: src/views/PlannerView.vue -->
<script setup lang="ts">
import WeekView from "@/components/WeekView.vue";
import TaskTemplateManager from "@/components/TaskTemplateManager.vue";
import TaskAnalytics from "@/components/TaskAnalytics.vue";
import CalendarDatePicker from "@/components/CalendarDatePicker.vue"; // ADDED
import { ref } from "vue";
import { useUIStore } from "@/stores/uiStore"; // ADDED

type ActiveView = "planner" | "templates" | "analytics";
const activeView = ref<ActiveView>("planner");

const uiStore = useUIStore();

function handleTodayClick() {
  uiStore.goToToday();
  activeView.value = "planner"; // switch to planner view
}
</script>

<template>
  <div class="planner-view-container">
    <aside class="planner-sidebar">
      <!-- MODIFICATION: New sidebar layout -->
      <button @click="handleTodayClick()" class="btn-primary today-button">
        Today
      </button>
      <CalendarDatePicker />

      <hr class="sidebar-divider" />

      <nav class="view-switcher">
        <button
          @click="activeView = 'planner'"
          :class="{ active: activeView === 'planner' }"
        >
          Planner
        </button>
        <button
          @click="activeView = 'templates'"
          :class="{ active: activeView === 'templates' }"
        >
          Templates
        </button>
        <button
          @click="activeView = 'analytics'"
          :class="{ active: activeView === 'analytics' }"
        >
          Analytics
        </button>
      </nav>
    </aside>
    <main class="planner-content">
      <WeekView v-if="activeView === 'planner'" />
      <TaskTemplateManager v-if="activeView === 'templates'" />
      <TaskAnalytics v-if="activeView === 'analytics'" />
    </main>
  </div>
</template>

<style scoped>
.planner-view-container {
  display: flex;
  height: calc(100vh - 80px); /* Adjust based on your header height */
  width: 100%;
  max-width: 1800px;
  margin: 0 auto;
}

.planner-sidebar {
  width: 280px;
  padding: 1rem;
  background-color: #fff;
  border-right: 1px solid #e0e0e0;
  flex-shrink: 0; /* Prevent sidebar from shrinking */
}

/* ADDED/MODIFIED Styles */
.today-button {
  width: 100%;
  margin-bottom: 1rem;
}
.sidebar-divider {
  border: none;
  border-top: 1px solid #e0e0e0;
  margin: 1rem 0;
}
.view-switcher {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.view-switcher button {
  width: 100%;
  text-align: left;
  background: none;
  border: 1px solid #ccc;
  padding: 0.5rem 0.8rem;
}
.view-switcher button.active {
  background-color: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
  font-weight: 500;
}

.planner-content {
  flex-grow: 1;
  overflow-y: auto;
}
</style>
