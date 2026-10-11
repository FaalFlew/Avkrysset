<template>
  <header class="app-header">
    <div class="logo">
      <RouterLink to="/">Time Planner</RouterLink>
    </div>
    <nav class="main-nav">
      <!-- Show different links based on authentication status -->
      <template v-if="authStore.isAuthenticated">
        <RouterLink to="/">Planner</RouterLink>
        <RouterLink to="/today">Today</RouterLink>
        <button @click="handleLogout" class="btn-secondary">Logout</button>
      </template>
      <template v-else>
        <RouterLink to="/today">Today</RouterLink>
        <RouterLink to="/login">Login</RouterLink>
      </template>
    </nav>
  </header>

  <!-- The router will render the current page component here -->
  <main class="main-content">
    <RouterView />
  </main>

  <!-- Global components that should be available on all pages -->
  <ToastNotification />
  <ConfirmDialog />
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import WeekView from "./components/WeekView.vue";
import TaskTemplateManager from "./components/TaskTemplateManager.vue";
import TaskAnalytics from "./components/TaskAnalytics.vue";
import ToastNotification from "./components/ToastNotification.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue"; // <-- Import it
import { RouterLink, RouterView, useRouter } from "vue-router"; // ADDED Router components
import { useAuthStore } from "./stores/authStore"; // ADDED
import { useTaskStore } from "./stores/taskStore"; // ADDED
import { onMounted } from "vue"; // ADDED

import { useUIStore } from "./stores/uiStore"; // ADDED
import { watch } from "vue"; // MODIFIED: Imported watch
import { storeToRefs } from "pinia"; // ADDED
import dayjs from "dayjs"; // ADDED

type View = "planner" | "templates" | "analytics";

const uiStore = useUIStore(); // ADDED
const authStore = useAuthStore(); // ADDED
const taskStore = useTaskStore(); // ADDED
const router = useRouter(); // ADDED
// ADDED: Create reactive references to the state we need to watch.
const { isAuthenticated } = storeToRefs(authStore);
const { currentDate } = storeToRefs(uiStore);
const currentView = ref<View>("planner");

// MODIFICATION: The onMounted hook is now simpler.
onMounted(async () => {
  // If the user is NOT authenticated, this will load their local data.
  // If they are authenticated, this will do nothing, because the watcher will handle it.
  if (!isAuthenticated.value) {
    await taskStore.initializeData();
  }
});

// --- MODIFIED: The central data fetching watcher is now smarter ---
watch(
  [isAuthenticated, currentDate],
  async ([isAuth, date], [wasAuth, oldDate]) => {
    // ADDED previous values

    // This watcher now handles two cases:
    // 1. The user just logged IN.
    // 2. The user is already logged in and changed the date.

    // Only proceed if the user is authenticated.
    if (isAuth) {
      // Check if this is the initial fetch after logging in.
      // `wasAuth` will be `false` if the user just transitioned from guest to logged in.
      const isInitialFetch = !wasAuth;

      if (isInitialFetch) {
        // --- THIS IS THE CORE FIX ---
        // On the very first fetch after login, we get EVERYTHING in order.
        await taskStore.initializeData(); // This fetches categories & templates
      }

      // Now, whether it's the initial fetch OR a date change, get the tasks for the current week.
      const weekStart = dayjs(date).startOf("isoWeek").toISOString();
      const weekEnd = dayjs(date).endOf("isoWeek").toISOString();
      await taskStore.fetchTasksForRange(weekStart, weekEnd);
    }
  },
  { immediate: true }
);

const components = {
  planner: WeekView,
  templates: TaskTemplateManager,
  analytics: TaskAnalytics,
};

// ADDED: Logout handler
async function handleLogout() {
  await authStore.logout();
  // After logout, re-initialize the taskStore to load guest data
  await taskStore.initializeData();
  // Redirect to the login page
  router.push("/login");
}

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
  /* Add a shrink factor to allow the title to get smaller if needed */
  flex-shrink: 1;
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
  /* Prevent buttons from shrinking */
  flex-shrink: 0;
  white-space: nowrap; /* Prevent text from wrapping */
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

/* --- NEW: Media Query for Mobile Responsiveness --- */
@media (max-width: 768px) {
  .app-header {
    padding: 0 0.5rem; /* Reduce horizontal padding */
    gap: 0.5rem; /* Add gap between title and nav */
  }

  .app-header h1 {
    font-size: 1rem; /* Smaller title */
  }

  .app-header nav {
    gap: 0; /* Remove gap as padding will handle spacing */
  }

  .app-header nav button {
    padding: 0.8rem 0.5rem; /* Significantly reduce padding */
    font-size: 0.8rem; /* Smaller font size for buttons */
  }
}

/* ADDED Styles for the main app layout */
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background-color: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  border-bottom: 1px solid #e0e0e0;
}

.logo a {
  font-weight: bold;
  font-size: 1.5rem;
  text-decoration: none;
  color: var(--font-color);
}

.main-nav {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.main-nav a,
.main-nav button {
  text-decoration: none;
  font-weight: 500;
  color: var(--font-color);
  font-size: 1rem;
}

.main-nav .router-link-active {
  color: var(--primary-color);
}

.main-content {
  flex-grow: 1;
  padding: 1rem;
  overflow: auto;
}
</style>
