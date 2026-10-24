<!-- src/views/PlannerView.vue -->
<script setup lang="ts">
/**
 * Planner page: header (Today / ‹ › / month picker / week badge / time zone), the week grid
 * (a single day with a scrollable day strip on phones), loading/error states and first-run help.
 * Shortcuts here: T today, J/→ next, K/← previous (week; day on phones), D week picker, Esc ends
 * tap-to-paste. After "Copy" in the task editor a banner says "Tap a time to paste “…”" (Cancel);
 * it stays across day/week changes until a paste succeeds or it is cancelled.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { ClipboardPaste, RotateCw, TriangleAlert } from "lucide-vue-next";
import WeekView from "@/components/WeekView.vue";
import PlannerHeader from "@/components/planner/PlannerHeader.vue";
import WeekStrip from "@/components/planner/WeekStrip.vue";
import PlannerOnboarding from "@/components/planner/PlannerOnboarding.vue";
import UiLoadingBar from "@/components/ui/UiLoadingBar.vue";
import UiButton from "@/components/ui/UiButton.vue";
import { useTasks } from "@/composables/useTasks";
import { useTaskStore } from "@/stores/taskStore";
import { useAuthStore } from "@/stores/authStore";
import { useClipboardStore } from "@/stores/clipboardStore";
import { displayTitle } from "@/lib/plannerFormat";
import { useBreakpoint } from "@/composables/useMediaQuery";
import { useToday } from "@/composables/useClock";
import { useTaskEditor } from "@/composables/useTaskEditor";
import { useHotkeyScope, isNeutralTarget } from "@/composables/useHotkeys";
import { toDateKey, type DateKey } from "@/lib/datetime";
import { isMutationSlow } from "@/services/slowRequests";

const ONBOARDING_KEY = "tp-onboarding-dismissed";
const SLOW_LOADING_MS = 2500;

const taskStore = useTaskStore();
const authStore = useAuthStore();
const editor = useTaskEditor();
const { currentDate, currentWeek, tasks, templates, categories, nextWeek, previousWeek, nextDay, previousDay, goToToday, selectDate } =
  useTasks();
const { isMobile, isDesktop, isCoarse } = useBreakpoint();
const clipboard = useClipboardStore();
const { isLoadingWeek, isInitializing, weekError, initError } = storeToRefs(taskStore);
const today = useToday();

const weekView = ref<InstanceType<typeof WeekView> | null>(null);
const header = ref<InstanceType<typeof PlannerHeader> | null>(null);
const weekStrip = ref<InstanceType<typeof WeekStrip> | null>(null);

/** 7 days on ≥ 768px; the selected day on phones. */
const visibleDays = computed<DateKey[]>(() => (isMobile.value ? [currentDate.value] : currentWeek.value));

onMounted(() => editor.setVisibleDaysProvider(() => visibleDays.value));
onBeforeUnmount(() => editor.setVisibleDaysProvider(null));

// ------------------------------------------------------------------ navigation
function goNext(): void {
  if (isMobile.value) nextDay();
  else nextWeek();
}
function goPrev(): void {
  if (isMobile.value) previousDay();
  else previousWeek();
}
function goToday(): void {
  goToToday();
  void nextTick(() => {
    weekView.value?.scrollToNow(true);
    // Today may already be selected while the phone strip is scrolled to another week.
    weekStrip.value?.revealSelected();
  });
}

// Auto-scroll when the week changes (not when switching days inside a week on phones).
watch(
  () => currentWeek.value[0],
  () => {
    void nextTick(() => weekView.value?.autoScroll(false));
  }
);

useHotkeyScope({
  t: () => goToday(),
  j: () => goNext(),
  k: () => goPrev(),
  d: () => {
    void header.value?.openPicker();
  },
  ArrowRight: (event) => {
    if (!isNeutralTarget(event.target)) return false;
    goNext();
  },
  ArrowLeft: (event) => {
    if (!isNeutralTarget(event.target)) return false;
    goPrev();
  },
  Escape: () => {
    if (!clipboard.isArmed) return false;
    cancelPaste();
  },
});

// ------------------------------------------------------------------ tap to paste
const pasteTitle = computed(() => (clipboard.isArmed && clipboard.copied ? displayTitle(clipboard.copied.title) : null));
function cancelPaste(): void {
  clipboard.disarm();
}

// ------------------------------------------------------------------ states
const isBusy = computed(() => isLoadingWeek.value || isInitializing.value);
const showSlowHint = ref(false);
let slowTimer: number | undefined;
watch(
  isBusy,
  (busy) => {
    window.clearTimeout(slowTimer);
    showSlowHint.value = false;
    if (busy) slowTimer = window.setTimeout(() => (showSlowHint.value = true), SLOW_LOADING_MS);
  },
  { immediate: true }
);
onBeforeUnmount(() => window.clearTimeout(slowTimer));

const errorMessage = computed(() => initError.value ?? weekError.value);
const retrying = ref(false);
async function retry(): Promise<void> {
  retrying.value = true;
  try {
    await taskStore.retryWeek();
  } finally {
    retrying.value = false;
  }
}

const weekTaskDays = computed(() => {
  const set = new Set<DateKey>();
  const range = { start: currentWeek.value[0]!, end: currentWeek.value[6]! };
  for (const task of tasks.value) {
    const day = toDateKey(task.start);
    if (day >= range.start && day <= range.end) set.add(day);
  }
  return set;
});
const weekIsEmpty = computed(() => weekTaskDays.value.size === 0);

const onboardingDismissed = ref(readDismissed());
function readDismissed(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}
function dismissOnboarding(): void {
  onboardingDismissed.value = true;
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* session only */
  }
}

const showOnboarding = computed(
  () =>
    !onboardingDismissed.value &&
    !isBusy.value &&
    !errorMessage.value &&
    templates.value.length === 0 &&
    categories.value.length <= 1 &&
    weekIsEmpty.value
);
</script>

<template>
  <div class="planner">
    <PlannerHeader
      ref="header"
      :days="visibleDays"
      :week="currentWeek"
      :mobile="isMobile"
      :show-time-zone="isDesktop"
      @today="goToday"
      @prev="goPrev"
      @next="goNext"
    />
    <WeekStrip
      v-if="isMobile"
      ref="weekStrip"
      :selected="currentDate"
      :today="today"
      :busy-days="weekTaskDays"
      @select="selectDate"
    />
    <UiLoadingBar :active="isBusy" class="planner__loading" />
    <p v-if="isBusy" class="sr-only" role="status">Loading tasks…</p>

    <div class="planner__body">
      <PlannerOnboarding
        v-if="showOnboarding && isMobile"
        class="planner__onboarding-inline"
        mobile
        :guest="!authStore.isAuthenticated"
        @dismiss="dismissOnboarding"
      />

      <div class="planner__grid-area">
        <WeekView
          ref="weekView"
          :days="visibleDays"
          :busy="isBusy"
          @navigate="selectDate"
          @advance="(side) => (side > 0 ? goNext() : goPrev())"
        />

        <div class="planner__overlay" aria-live="polite">
          <div v-if="pasteTitle" class="paste-banner">
            <ClipboardPaste :size="16" class="paste-banner__icon" />
            <p class="paste-banner__text">
              {{ isCoarse ? "Tap" : "Click" }} a time to paste “<span class="paste-banner__title">{{ pasteTitle }}</span>”
            </p>
            <UiButton class="paste-banner__action" size="sm" variant="ghost" @click="cancelPaste">Cancel</UiButton>
          </div>
          <div v-if="errorMessage" class="banner" role="alert">
            <TriangleAlert :size="16" class="banner__icon" />
            <p class="banner__text">{{ errorMessage }}</p>
            <UiButton class="banner__action" size="sm" variant="secondary" :loading="retrying" @click="retry">
              <template #leading><RotateCw :size="14" /></template>
              Retry
            </UiButton>
          </div>
          <!-- Not twice: the app-wide indicator already says it while a change is waiting. -->
          <p v-else-if="isBusy && showSlowHint && !isMutationSlow" class="pill">
            Waking up the server… this can take a few seconds.
          </p>
        </div>

        <PlannerOnboarding
          v-if="showOnboarding && !isMobile"
          class="planner__onboarding-floating"
          floating
          :guest="!authStore.isAuthenticated"
          @dismiss="dismissOnboarding"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.planner {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.planner__loading {
  flex-shrink: 0;
  margin-top: -2px;
  position: relative;
  z-index: var(--z-sticky);
}
.planner__body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.planner__onboarding-inline {
  margin: var(--space-3);
  flex-shrink: 0;
}
.planner__grid-area {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}

/* Status line at the top of the grid body (below the sticky day headers). */
.planner__overlay {
  position: absolute;
  top: calc(var(--dayhead-h) + var(--space-3));
  left: 50%;
  z-index: var(--z-sticky);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  justify-content: center;
  width: min(640px, calc(100% - 32px));
  transform: translateX(-50%);
  pointer-events: none;
}
.planner__overlay > * {
  pointer-events: auto;
}
.pill {
  max-width: 100%;
  padding: var(--space-1-5) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background-color: var(--bg-raised);
  box-shadow: var(--shadow-xs);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
  text-align: center;
  pointer-events: none;
}
.paste-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-full);
  background-color: var(--bg-raised);
  box-shadow: var(--shadow-sm);
}
.paste-banner__icon {
  flex-shrink: 0;
  color: var(--accent-text);
}
.paste-banner__text {
  display: flex;
  min-width: 0;
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-primary);
  white-space: nowrap;
}
.paste-banner__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: var(--fw-semibold);
}
.paste-banner__action {
  flex-shrink: 0;
}
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-2-5);
  width: 100%;
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  border: 1px solid var(--danger-border);
  border-radius: var(--radius-md);
  background-color: var(--danger-subtle);
  box-shadow: var(--shadow-sm);
}
.banner__icon {
  color: var(--danger-text);
}
.banner__action {
  flex-shrink: 0;
}
.banner__text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-primary);
}
.planner__onboarding-floating {
  position: absolute;
  top: calc(var(--dayhead-h) + var(--space-3));
  right: var(--space-6);
  z-index: var(--z-sticky);
}
</style>
