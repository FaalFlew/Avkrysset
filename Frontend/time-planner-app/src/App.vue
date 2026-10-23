<script setup lang="ts">
/**
 * App shell. Auth routes (meta.layout = 'auth') render bare (their views bring AuthLayout);
 * everything else gets: skip link, sidebar/rail (≥ 768) or bottom tab bar (< 768), <main>,
 * the mobile FAB, and the global overlays (task editor, shortcuts, toast, confirm).
 */
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { Plus } from "lucide-vue-next";
import ToastNotification from "./components/ToastNotification.vue";
import ServerWakeIndicator from "./components/ServerWakeIndicator.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import TaskEditor from "./components/TaskEditor.vue";
import ShortcutsDialog from "./components/ShortcutsDialog.vue";
import AppSidebar from "./components/shell/AppSidebar.vue";
import AppTabBar from "./components/shell/AppTabBar.vue";
import SidebarDrawer from "./components/shell/SidebarDrawer.vue";
import { NAV_ITEMS } from "./components/shell/navItems";
import { useShell } from "./components/shell/useShell";
import { useAuthStore } from "./stores/authStore";
import { useTaskStore } from "./stores/taskStore";
import { useUIStore } from "./stores/uiStore";
import { useBreakpoint } from "./composables/useMediaQuery";
import { useTaskEditor } from "./composables/useTaskEditor";
import { installHotkeys, type HotkeyMap } from "./composables/useHotkeys";
import { useTimeZone } from "./composables/useClock";
import { installSessionWarmup } from "./composables/useSessionWarmup";
import { closeSessionBoundUi, onSessionChange } from "./composables/useSessionBound";
import { weekDaysOf, weekRange } from "@/lib/datetime";

const uiStore = useUIStore();
const authStore = useAuthStore();
const taskStore = useTaskStore();
const route = useRoute();
const router = useRouter();
const editor = useTaskEditor();
const { isMobile, isTablet, isDesktop, isCoarse } = useBreakpoint();
const { sidebarMode, toggleSidebar } = useShell();
const { isAuthenticated } = storeToRefs(authStore);
const { currentDate, announcement } = storeToRefs(uiStore);
const { timeZone } = useTimeZone();

/** Nothing is rendered until the first route resolves (so auth pages never flash the shell). */
const isReady = computed(() => route.matched.length > 0);
const isAuthLayout = computed(() => route.meta.layout === "auth");
const isPlanner = computed(() => route.name === "Planner");
const showFab = computed(
  () => isMobile.value && (route.name === "Planner" || route.name === "Today") && !editor.state.open
);

// ---------------------------------------------------------------- data loading
// Monday (DateKey) of the selected ISO week: tasks are refetched only when the week changes
// (switching days inside a week on phones does not refetch).
const currentWeekStart = computed(() => weekDaysOf(currentDate.value)[0]!);

onMounted(() => {
  // Guests: load local data. Signed-in users are handled by the watcher below.
  if (!isAuthenticated.value) void taskStore.initializeData();
});

// Signed in: load categories & templates on login/start, and the selected week's tasks
// whenever the week changes. Signed out (logout, expired session): back to guest data.
// A device time-zone change also refetches: the same week starts at a different instant.
watch(
  [isAuthenticated, currentWeekStart, timeZone],
  async ([isAuth, weekStart], [wasAuth]) => {
    if (!isAuth) {
      if (wasAuth) await taskStore.initializeData();
      return;
    }
    if (!wasAuth) await taskStore.initializeData();
    // Half-open [Monday 00:00, next Monday 00:00) in the user's zone.
    await taskStore.fetchTasksForRange(weekRange(weekStart));
  },
  { immediate: true }
);

// Signed in: wake a cold server and refresh an expired token on load and when the tab comes back
// after a long time away, before the user acts (composables/useSessionWarmup.ts).
let uninstallWarmup: (() => void) | null = null;
onMounted(() => {
  uninstallWarmup = installSessionWarmup();
});
onBeforeUnmount(() => uninstallWarmup?.());

// A session that ends (or starts) closes the editor, confirm dialogs and Undo toasts of the old one.
onSessionChange(closeSessionBoundUi);

// ---------------------------------------------------------------- hotkeys
function guard(fn: () => unknown): () => boolean | void {
  return () => {
    if (isAuthLayout.value) return false;
    fn();
  };
}

const globalKeys: HotkeyMap = {
  n: guard(() => editor.openCreate()),
  c: guard(() => editor.openCreate()),
  "[": () => {
    if (isAuthLayout.value || !isDesktop.value) return false;
    toggleSidebar();
  },
  "?": () => {
    if (isAuthLayout.value || isCoarse.value) return false;
    uiStore.openShortcuts();
  },
};
for (const item of NAV_ITEMS) {
  globalKeys[item.shortcut] = guard(() => router.push(item.to));
}

let uninstallHotkeys: (() => void) | null = null;
onMounted(() => {
  uninstallHotkeys = installHotkeys(globalKeys, () => uiStore.runToastUndo());
});
onBeforeUnmount(() => uninstallHotkeys?.());

// Toast pause on hover/focus is handled by ToastNotification itself (uiStore.pauseToast/resumeToast).

// ---------------------------------------------------------------- skip link
function skipToContent(): void {
  const main = document.getElementById("main");
  const target = main?.querySelector<HTMLElement>("[data-page-heading]") ?? main;
  target?.focus();
}
</script>

<template>
  <template v-if="isReady">
    <RouterView v-if="isAuthLayout" />
    <div v-else class="app-shell" :class="`app-shell--${sidebarMode}`">
      <a href="#main" class="skip-link" @click.prevent="skipToContent">Skip to content</a>

      <div v-if="sidebarMode !== 'hidden'" class="app-shell__sidebar">
        <AppSidebar :variant="sidebarMode === 'expanded' ? 'expanded' : 'rail'" @toggle="toggleSidebar" />
      </div>

      <main id="main" class="app-shell__main" :class="{ 'is-planner': isPlanner }" tabindex="-1">
        <!-- Keyed on the time zone: if the device zone changes (travel), the page remounts so every
             position/label is recomputed and Today/Analytics refetch on mount. Keyed on the auth
             state too: pages pick guest or account data at setup, so a session that ends or starts
             underneath them (e.g. a logout in another tab) remounts them in the right mode. -->
        <RouterView :key="`${timeZone}|${isAuthenticated}`" />
      </main>

      <AppTabBar v-if="isMobile" />

      <Transition name="fab">
        <button
          v-if="showFab"
          type="button"
          class="fab"
          :class="{ 'fab--raised': uiStore.toast.isVisible }"
          aria-label="New task"
          @click="editor.openCreate()"
        >
          <Plus :size="24" />
        </button>
      </Transition>
    </div>

    <SidebarDrawer v-if="isTablet && !isAuthLayout" />
    <!-- "Waking up the server…" while a change waits for a cold API (sign-in pages have their own). -->
    <ServerWakeIndicator v-if="!isAuthLayout" />
  </template>

  <!-- Global overlays (teleported to <body>) -->
  <TaskEditor />
  <ShortcutsDialog />
  <ToastNotification />
  <ConfirmDialog />
  <Teleport to="body">
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</div>
  </Teleport>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  background-color: var(--bg-app);
}
.app-shell--hidden {
  grid-template-columns: minmax(0, 1fr);
}

.app-shell__sidebar {
  display: flex;
  min-height: 0;
  border-right: 1px solid var(--border-subtle);
  background-color: var(--bg-sidebar);
}

.app-shell__main {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  outline: none;
  background-color: var(--bg-app);
}
.app-shell__main.is-planner {
  overflow: hidden;
}
@media (max-width: 767.98px) {
  .app-shell__main {
    padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
  }
}

/* ---------- FAB (phones, Planner/Today) ---------- */
.fab {
  position: fixed;
  right: var(--space-4);
  bottom: calc(var(--tabbar-h) + var(--space-4) + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-sticky);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-full);
  background-color: var(--accent);
  color: var(--text-on-accent);
  box-shadow: var(--shadow-md);
  transition: transform var(--dur-base) var(--ease-standard), background-color var(--dur-fast) var(--ease-standard);
}
.fab:hover {
  background-color: var(--accent-hover);
}
.fab:active {
  background-color: var(--accent-active);
}
/* Keep clear of a visible toast (it sits just above the tab bar). */
.fab--raised {
  transform: translateY(-56px);
}
.fab-enter-active,
.fab-leave-active {
  transition: opacity var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard);
}
.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>
