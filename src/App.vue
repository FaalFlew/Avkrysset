<template>
  <div id="app-container">
    <header class="app-header">
      <h1>🕒 Visual Time Planner</h1>
      <nav>
        <button
          @click="currentView = 'planner'"
          :class="{ active: currentView === 'planner' }"
        >
          Planner
        </button>
      </nav>
    </header>
    <main class="app-main">
      <KeepAlive>
        <component :is="activeComponent" />
      </KeepAlive>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, shallowRef } from "vue";
import WeekView from "./components/WeekView.vue";

type View = "planner";

const currentView = ref<View>("planner");

const components = {
  planner: WeekView,
};

const activeComponent = computed(() => components[currentView.value]);
</script>

<style>
#app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 2rem;
  background-color: white;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}

.app-header h1 {
  font-size: 1.5rem;
  font-weight: 600;
}

.app-header nav {
  display: flex;
  gap: 0.5rem;
}

.app-header nav button {
  padding: 1rem 1.5rem;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  border-radius: 0;
  font-size: 1rem;
  color: #555;
  transition: all 0.2s ease-in-out;
}

.app-header nav button.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}

.app-main {
  flex-grow: 1;
  overflow-y: auto;
  background-color: var(--background-color);
}
</style>
