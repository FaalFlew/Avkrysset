<script setup lang="ts">
/**
 * AppSidebar — primary navigation for ≥ 768px.
 * Props:
 *   variant: 'expanded' | 'rail'
 *   inDrawer?: boolean — rendered inside the tablet overlay drawer (the collapse button closes it)
 * Emits:
 *   toggle — collapse/expand (rail ⇄ expanded, or open the drawer on tablets)
 *   close — close the drawer (inDrawer only)
 */
import { computed } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { Keyboard, LogIn, LogOut, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-vue-next";
import AppLogo from "@/components/ui/AppLogo.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiCard from "@/components/ui/UiCard.vue";
import UiIconButton from "@/components/ui/UiIconButton.vue";
import UiKbd from "@/components/ui/UiKbd.vue";
import UiThemeToggle from "@/components/ui/UiThemeToggle.vue";
import UiTooltip from "@/components/ui/UiTooltip.vue";
import CalendarDatePicker from "@/components/CalendarDatePicker.vue";
import { NAV_ITEMS } from "./navItems";
import { logoutAndRedirect } from "./useShell";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useTaskEditor } from "@/composables/useTaskEditor";
import { useBreakpoint } from "@/composables/useMediaQuery";
import type { DateKey } from "@/lib/datetime";

const props = withDefaults(defineProps<{ variant: "expanded" | "rail"; inDrawer?: boolean }>(), {
  inDrawer: false,
});
const emit = defineEmits<{ toggle: []; close: [] }>();

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const uiStore = useUIStore();
const editor = useTaskEditor();
const { isDesktop, isCoarse } = useBreakpoint();

const isAuthenticated = computed(() => authStore.isAuthenticated);
const showCalendar = computed(() => route.name === "Planner" || route.name === "Today");
const collapseShortcut = computed(() => (isDesktop.value ? ["["] : undefined));

function newTask(): void {
  if (props.inDrawer) emit("close");
  editor.openCreate();
}

function onPickDate(_day: DateKey): void {
  if (route.name !== "Planner") void router.push("/");
  if (props.inDrawer) emit("close");
}

function onCollapse(): void {
  if (props.inDrawer) emit("close");
  else emit("toggle");
}

async function logout(): Promise<void> {
  if (props.inDrawer) emit("close");
  await logoutAndRedirect(router);
}
</script>

<template>
  <!-- ===== Expanded ===== -->
  <div v-if="variant === 'expanded'" class="sidebar sidebar--expanded">
    <div class="sidebar__brand">
      <RouterLink to="/" class="sidebar__logo" aria-label="Time Planner, go to planner">
        <AppLogo with-wordmark />
      </RouterLink>
      <UiIconButton
        :label="inDrawer ? 'Close sidebar' : 'Collapse sidebar'"
        :shortcut="inDrawer ? undefined : collapseShortcut"
        size="sm"
        tooltip-placement="bottom"
        @click="onCollapse"
      >
        <PanelLeftClose :size="16" />
      </UiIconButton>
    </div>

    <UiButton variant="primary" block class="sidebar__new" @click="newTask">
      <template #leading><Plus :size="16" /></template>
      New task
      <template v-if="!isCoarse" #trailing><UiKbd :keys="['N']" tone="onAccent" /></template>
    </UiButton>

    <nav class="sidebar__nav" aria-label="Primary">
      <ul role="list" class="sidebar__nav-list">
        <li v-for="item in NAV_ITEMS" :key="item.name">
          <RouterLink :to="item.to" class="nav-item" :aria-keyshortcuts="item.shortcut" @click="inDrawer && emit('close')">
            <component :is="item.icon" class="nav-item__icon" :size="18" />
            <span class="nav-item__label">{{ item.label }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <section v-if="showCalendar" class="sidebar__calendar" aria-labelledby="sidebar-calendar-label">
      <p id="sidebar-calendar-label" class="sidebar__micro">Calendar</p>
      <CalendarDatePicker compact @select="onPickDate" />
    </section>

    <div class="sidebar__footer">
      <UiCard v-if="!isAuthenticated" padding="md" class="guest-card" as="div">
        <p class="guest-card__title">Guest mode</p>
        <p class="guest-card__text">Your plans are saved in this browser only.</p>
        <div class="guest-card__actions">
          <UiButton variant="primary" size="sm" block to="/register">Create account</UiButton>
          <UiButton variant="ghost" size="sm" block to="/login">Log in</UiButton>
        </div>
      </UiCard>
      <div class="sidebar__footer-row">
        <UiThemeToggle variant="segmented" size="sm" />
        <span class="sidebar__spacer" />
        <UiIconButton
          v-if="!isCoarse"
          label="Keyboard shortcuts"
          :shortcut="['?']"
          size="sm"
          @click="uiStore.openShortcuts()"
        >
          <Keyboard :size="16" />
        </UiIconButton>
        <UiIconButton v-if="isAuthenticated" label="Log out" size="sm" @click="logout">
          <LogOut :size="16" />
        </UiIconButton>
      </div>
    </div>
  </div>

  <!-- ===== Rail ===== -->
  <div v-else class="sidebar sidebar--rail">
    <UiIconButton
      label="Expand sidebar"
      :shortcut="collapseShortcut"
      size="lg"
      tooltip-placement="right"
      @click="emit('toggle')"
    >
      <PanelLeftOpen :size="18" />
    </UiIconButton>
    <UiIconButton
      label="New task"
      variant="primary"
      size="lg"
      :shortcut="['N']"
      tooltip-placement="right"
      class="rail__new"
      @click="newTask"
    >
      <Plus :size="18" />
    </UiIconButton>

    <nav class="rail__nav" aria-label="Primary">
      <ul role="list" class="rail__list">
        <li v-for="item in NAV_ITEMS" :key="item.name">
          <UiTooltip :text="item.label" :shortcut="[item.shortcut]" placement="right">
            <RouterLink :to="item.to" class="rail-item" :aria-label="item.label" :aria-keyshortcuts="item.shortcut">
              <component :is="item.icon" :size="18" />
            </RouterLink>
          </UiTooltip>
        </li>
      </ul>
    </nav>

    <div class="rail__footer">
      <UiThemeToggle variant="cycle" />
      <UiIconButton
        v-if="!isCoarse"
        label="Keyboard shortcuts"
        :shortcut="['?']"
        tooltip-placement="right"
        @click="uiStore.openShortcuts()"
      >
        <Keyboard :size="16" />
      </UiIconButton>
      <UiIconButton v-if="isAuthenticated" label="Log out" tooltip-placement="right" @click="logout">
        <LogOut :size="16" />
      </UiIconButton>
      <UiIconButton v-else label="Log in" to="/login" tooltip-placement="right">
        <LogIn :size="16" />
      </UiIconButton>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background-color: var(--bg-sidebar);
}

/* ---------- expanded ---------- */
.sidebar--expanded {
  width: var(--sidebar-w);
  padding: var(--space-3);
  gap: var(--space-3);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
@media (max-height: 760px) {
  .sidebar--expanded {
    gap: var(--space-2);
    padding-top: var(--space-2);
    padding-bottom: var(--space-2);
  }
}

.sidebar__brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  height: 40px;
  padding-left: var(--space-1-5);
  flex-shrink: 0;
}
.sidebar__logo {
  display: inline-flex;
  align-items: center;
  color: var(--text-primary);
  text-decoration: none;
  border-radius: var(--radius-sm);
}

.sidebar__new {
  flex-shrink: 0;
}
.sidebar__new :deep(.ui-button__label) {
  flex: 1 1 auto;
  text-align: left;
}

.sidebar__nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-2-5);
  height: 32px;
  padding: 0 var(--space-2-5);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  font-weight: var(--fw-medium);
  text-decoration: none;
  transition: background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.nav-item__icon {
  color: var(--text-tertiary);
  transition: color var(--dur-fast) var(--ease-standard);
}
.nav-item:hover {
  background-color: var(--bg-subtle);
  color: var(--text-primary);
}
.nav-item[aria-current="page"] {
  background-color: var(--bg-muted);
  color: var(--text-primary);
}
.nav-item[aria-current="page"] .nav-item__icon {
  color: var(--accent-text);
}
@media (pointer: coarse) {
  .nav-item {
    height: 44px;
  }
}

.sidebar__micro {
  margin: 0 0 var(--space-1-5) var(--space-1-5);
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-medium);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.sidebar__footer {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: auto;
  padding-top: var(--space-2);
}
.sidebar__footer-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.sidebar__spacer {
  flex: 1 1 auto;
}

.guest-card {
  background-color: var(--bg-surface);
}
.guest-card__title {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.guest-card__text {
  margin-top: var(--space-1);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-secondary);
}
.guest-card__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  margin-top: var(--space-3);
}

/* ---------- rail ---------- */
.sidebar--rail {
  width: var(--rail-w);
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0 var(--space-3);
  overflow-y: auto;
  overflow-x: hidden;
}
.rail__new {
  margin-bottom: var(--space-2);
}
.rail__list {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
}
.rail-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  transition: background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.rail-item:hover {
  background-color: var(--bg-subtle);
  color: var(--text-primary);
}
.rail-item[aria-current="page"] {
  background-color: var(--bg-muted);
  color: var(--accent-text);
}
@media (pointer: coarse) {
  .rail-item {
    width: 44px;
    height: 44px;
  }
}
.rail__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  margin-top: auto;
}
</style>
