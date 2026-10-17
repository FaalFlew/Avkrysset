<!-- src/components/TaskAnalytics.vue — the /analytics page body (rendered inside the app shell). -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CalendarRange, ChartColumn } from "lucide-vue-next";
import { UiButton, UiEmptyState, UiErrorState, UiPageHeader } from "@/components/ui";
import { useStats, type AnalyticsView } from "@/composables/useStats";
import {
  analyticsBuckets,
  analyticsRange,
  defaultAnalyticsPeriod,
  defaultDailyWeek,
  type AnalyticsSelection,
} from "@/lib/analyticsBuckets";
import { dateKeyParts, isoWeekOf, isoWeeksInYear, todayKey } from "@/lib/datetime";
import { useToday } from "@/composables/useClock";
import { formatHours } from "@/lib/format";
import AnalyticsFilters from "./analytics/AnalyticsFilters.vue";
import KpiTiles from "./analytics/KpiTiles.vue";
import HoursBarChart from "./analytics/HoursBarChart.vue";
import CategoryDonut from "./analytics/CategoryDonut.vue";
import TemplateBreakdown from "./analytics/TemplateBreakdown.vue";
import ExportMenu from "./analytics/ExportMenu.vue";
import PrintReportHeader from "./analytics/PrintReportHeader.vue";
import TaskList from "./analytics/TaskList.vue";
import { selectionShortLabel, selectionSummary } from "./analytics/format";
import { installPrintSupport } from "@/composables/usePrintMode";
import { usePaperPreference } from "@/lib/paper";
import { useAnalyticsTasks } from "@/composables/useAnalyticsTasks";
import { useTaskEditor } from "@/composables/useTaskEditor";
import { useTaskStore } from "@/stores/taskStore";
import { useAuthStore } from "@/stores/authStore";
import type { TaskListRow } from "@/lib/taskList";

const { availableYears, availableIsoYears, useFilteredStats } = useStats();
const today = useToday();

// --- Filters ------------------------------------------------------------------------------
// The Month view counts calendar years; the Week and Day views count ISO week-years, which
// differ around New Year (2027-01-01 is in 2026-W53, 2024-12-30 in 2025-W01). Each numbering
// starts from its own current year (or the newest year with data).
const defaults = defaultAnalyticsPeriod(todayKey(), availableYears.value, availableIsoYears.value);
const calendarYear = ref(defaults.calendarYear);
const isoYear = ref(defaults.isoYear);
const selectedView = ref<AnalyticsView>("monthly");
const usesIsoYear = computed(() => selectedView.value !== "monthly");

/** The year the current view shows; picking a year applies it to both numberings. */
const selectedYear = computed<number>({
  get: () => (usesIsoYear.value ? isoYear.value : calendarYear.value),
  set: (year) => {
    calendarYear.value = year;
    isoYear.value = year;
  },
});

/** Number of ISO weeks (52 or 53) in the selected ISO week-year. */
const weeksInSelectedYear = computed(() => isoWeeksInYear(isoYear.value));

const dailyWeek = ref(defaults.dailyWeek);
const monthRange = ref({ start: 0, end: 11 });
const weekRange = ref({ start: 1, end: weeksInSelectedYear.value });

// Keep week selections valid when the year changes (2026 has 53 ISO weeks, 2027 has 52);
// a range that ended on the last week keeps ending on the last week.
watch(weeksInSelectedYear, (weeks, previousWeeks) => {
  const range = weekRange.value;
  const end = range.end === previousWeeks ? weeks : Math.min(range.end, weeks);
  const start = Math.min(range.start, end);
  if (end !== range.end || start !== range.start) weekRange.value = { start, end };
  if (dailyWeek.value > weeks) dailyWeek.value = weeks;
});

/** Calendar years (Month) or ISO week-years (Week, Day) with data, plus the current one. */
const yearOptions = computed(() => {
  const years = usesIsoYear.value
    ? [...availableIsoYears.value, isoYear.value, isoWeekOf(today.value).isoYear]
    : [...availableYears.value, calendarYear.value, dateKeyParts(today.value).year];
  return [...new Set(years)].sort((a, b) => b - a);
});

const isFullYear = computed(() =>
  selectedView.value === "monthly"
    ? monthRange.value.start === 0 && monthRange.value.end === 11
    : selectedView.value === "weekly"
      ? weekRange.value.start === 1 && weekRange.value.end === weeksInSelectedYear.value
      : false
);

const canReset = computed(() =>
  selectedView.value === "daily"
    ? dailyWeek.value !== defaultDailyWeek(today.value, isoYear.value)
    : !isFullYear.value
);

function resetRange(): void {
  if (selectedView.value === "monthly") monthRange.value = { start: 0, end: 11 };
  else if (selectedView.value === "weekly") weekRange.value = { start: 1, end: weeksInSelectedYear.value };
  else dailyWeek.value = defaultDailyWeek(today.value, isoYear.value);
}

/** Empty-range action: widen to the whole selected year. */
function showWholeYear(): void {
  if (selectedView.value === "daily") selectedView.value = "weekly";
  if (selectedView.value === "monthly") monthRange.value = { start: 0, end: 11 };
  else weekRange.value = { start: 1, end: weeksInSelectedYear.value };
}

// --- Data ---------------------------------------------------------------------------------
const stats = useFilteredStats({
  year: selectedYear,
  view: selectedView,
  monthRange,
  weekRange,
  dailyWeek,
});
const { snapshot, isLoading, isRefetching, error, hasAnyData } = stats;

const currentSelection = computed<AnalyticsSelection>(() => ({
  view: selectedView.value,
  year: selectedYear.value,
  monthRange: { ...monthRange.value },
  weekRange: { ...weekRange.value },
  dailyWeek: dailyWeek.value,
}));

const subtitle = computed(() =>
  selectionSummary(currentSelection.value, analyticsBuckets(currentSelection.value).length)
);

/** Labels describe the data on screen (which lags the filters while refetching). */
const shownSelection = computed(() => snapshot.value?.selection ?? currentSelection.value);
const scopeLabel = computed(() => selectionShortLabel(shownSelection.value));
/** Range of the data on screen, for the print header and the guest CSV. */
const shownRangeLabel = computed(() =>
  selectionSummary(shownSelection.value, analyticsBuckets(shownSelection.value).length)
);
const shownRange = computed(() => analyticsRange(shownSelection.value));

type PageState = "error" | "loading" | "first-run" | "empty" | "ready";
const state = computed<PageState>(() => {
  if (error.value) return "error";
  if (isLoading.value || !snapshot.value) return "loading";
  if (!hasAnyData.value) return "first-run";
  if (snapshot.value.totalHours <= 0) return "empty";
  return "ready";
});

const retrying = computed(() => isLoading.value || isRefetching.value);

// --- Task list ------------------------------------------------------------------------------
// The same range as the analytics request; categories (incl. the organization colors) come from
// the analytics data on screen. A task changed from the list's editor refreshes both.
const taskList = useAnalyticsTasks({
  selection: currentSelection,
  categories: () => snapshot.value?.categories ?? [],
  onTasksChanged: () => void stats.refetch(),
});
const { rows: taskRows, isLoading: tasksLoading, isRefetching: tasksRefetching, error: tasksError } = taskList;
// (While the whole page refetches, the content is dimmed already: the list doesn't dim twice.)

/** The task list's category filter (chips, or a click in the donut). */
const categoryFilter = ref<string | null>(null);
const taskListRef = ref<InstanceType<typeof TaskList> | null>(null);

function onCategorySelect(id: string): void {
  if (categoryFilter.value === id) {
    categoryFilter.value = null; // clicking the selected category again clears the filter
    return;
  }
  categoryFilter.value = id;
  void nextTick(() => taskListRef.value?.reveal());
}

const editor = useTaskEditor();
const taskStore = useTaskStore();
const auth = useAuthStore();

/** Open a task of the list in the editor (read-only for tasks the user may not edit). */
function openTask(row: TaskListRow): void {
  // Signed in, the store only holds the planner's week: make the task known to it so the
  // editor's Delete (with Undo) works from here too. Guests hold every task already.
  if (auth.isAuthenticated) taskStore.replaceTaskLocally(row.task);
  editor.openEdit(row.task);
}

// --- Print ("Print / Save as PDF" and the browser's own Print) ------------------------------
const { paper } = usePaperPreference();
let uninstallPrint: (() => void) | null = null;
onMounted(() => {
  uninstallPrint = installPrintSupport(() => paper.value);
});
onBeforeUnmount(() => uninstallPrint?.());

const liveMessage = computed(() => {
  switch (state.value) {
    case "loading":
      return "Loading analytics";
    case "empty":
      return "No time planned in this period";
    case "ready":
      return isRefetching.value
        ? "Updating analytics"
        : `${formatHours(snapshot.value?.totalHours ?? 0)} planned, ${scopeLabel.value}`;
    default:
      return "";
  }
});
</script>

<template>
  <div class="analytics-page print-report">
    <PrintReportHeader :range-label="shownRangeLabel" :range="shownRange" />

    <UiPageHeader class="analytics-header" title="Analytics" :subtitle="subtitle" data-print-hide>
      <template #actions>
        <ExportMenu
          :selection="currentSelection"
          :snapshot="snapshot"
          :page-state="state"
          :refetching="isRefetching"
          :range-label="shownRangeLabel"
          :task-rows="taskRows"
        />
      </template>
      <AnalyticsFilters
        v-model:view="selectedView"
        v-model:year="selectedYear"
        v-model:month-range="monthRange"
        v-model:week-range="weekRange"
        v-model:daily-week="dailyWeek"
        :years="yearOptions"
        :can-reset="canReset"
        @reset="resetRange"
      />
    </UiPageHeader>

    <p class="sr-only" role="status" aria-live="polite">{{ liveMessage }}</p>

    <div class="analytics-body" :aria-busy="state === 'loading' || isRefetching || undefined">
      <Transition name="analytics-fade" mode="out-in">
        <div v-if="state === 'error'" key="error" class="state-panel">
          <UiErrorState
            title="Couldn't load analytics"
            description="Check your connection and try again. If the server was asleep, it can take a few seconds to wake up."
            :retrying="retrying"
            @retry="stats.refetch()"
          />
        </div>

        <div v-else-if="state === 'first-run'" key="first-run" class="state-panel">
          <UiEmptyState
            :icon="ChartColumn"
            title="See where your time goes"
            description="Once you've planned a few tasks, you'll see totals by category, template and period here."
          >
            <template #actions>
              <UiButton variant="primary" to="/">Plan your week</UiButton>
            </template>
          </UiEmptyState>
        </div>

        <div
          v-else-if="state === 'empty'"
          key="empty"
          class="state-panel"
          :class="{ 'is-refetching': isRefetching }"
        >
          <UiEmptyState
            :icon="CalendarRange"
            title="No time planned in this period"
            description="Try a wider range, or plan a few tasks and come back."
          >
            <template #actions>
              <UiButton v-if="!isFullYear" variant="secondary" @click="showWholeYear">
                Show all of {{ selectedYear }}
              </UiButton>
              <UiButton variant="ghost" to="/">Open planner</UiButton>
            </template>
          </UiEmptyState>
        </div>

        <div
          v-else
          key="content"
          class="analytics-content"
          :class="{ 'is-refetching': isRefetching }"
        >
          <KpiTiles :snapshot="snapshot" :scope-label="scopeLabel" :loading="state === 'loading'" />

          <div class="charts-row">
            <HoursBarChart
              :periods="snapshot?.periods ?? []"
              :view="shownSelection.view"
              :total-hours="snapshot?.totalHours ?? 0"
              :scope-label="scopeLabel"
              :sparse="snapshot?.sparse ?? false"
              :loading="state === 'loading'"
              :refetching="isRefetching"
            />
            <CategoryDonut
              :categories="snapshot?.categories ?? []"
              :total-hours="snapshot?.totalHours ?? 0"
              :scope-label="scopeLabel"
              :loading="state === 'loading'"
              :refetching="isRefetching"
              :selected-id="categoryFilter"
              @select="onCategorySelect"
            />
          </div>

          <TemplateBreakdown
            :templates="snapshot?.templates ?? []"
            :untemplated-hours="snapshot?.untemplatedHours ?? 0"
            :total-hours="snapshot?.totalHours ?? 0"
            :scope-label="scopeLabel"
            :loading="state === 'loading'"
            :refetching="isRefetching"
          />

          <TaskList
            ref="taskListRef"
            v-model:category="categoryFilter"
            :rows="taskRows"
            :loading="tasksLoading"
            :refetching="tasksRefetching && !isRefetching"
            :error="tasksError"
            :scope-label="scopeLabel"
            @open="openTask"
            @retry="taskList.refetch()"
          />
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.analytics-page {
  container: analytics / inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--space-6) var(--space-8) var(--space-10);
}

/*
 * The Export block may shrink to the header row's width (its busy state wraps inside it instead of
 * pushing the page sideways on phones) and stays right-aligned when it wraps under the title.
 */
.analytics-header :deep(.ui-page-header__actions) {
  flex-shrink: 1;
  min-width: 0;
  max-width: 100%;
  margin-left: auto;
}

.analytics-body {
  min-width: 0;
}

.analytics-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  transition: opacity var(--dur-base) var(--ease-standard);
}

/* Refetch keeps the frame: previous data stays, dimmed, while the new range loads. */
.is-refetching {
  opacity: 0.6;
}

.charts-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
}

@container analytics (min-width: 960px) {
  .charts-row {
    grid-template-columns: minmax(0, 8fr) minmax(0, 4fr);
  }
}

.state-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: var(--space-12) var(--space-6);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background-color: var(--bg-surface);
  transition: opacity var(--dur-base) var(--ease-standard);
}

.analytics-fade-enter-active,
.analytics-fade-leave-active {
  transition: opacity var(--dur-fast) var(--ease-standard);
}
.analytics-fade-enter-from,
.analytics-fade-leave-to {
  opacity: 0;
}

@media (max-width: 767.98px) {
  .analytics-page {
    gap: var(--space-4);
    padding: var(--space-4) var(--space-4) var(--space-8);
  }
  .state-panel {
    min-height: 260px;
    padding: var(--space-10) var(--space-4);
  }
}

/* Paper: the page margins come from @page (src/styles/print.css). */
@media print {
  .analytics-page {
    max-width: none;
    padding: 0;
    gap: var(--space-4);
  }
  .analytics-content {
    gap: var(--space-3);
  }
  .is-refetching {
    opacity: 1;
  }
}
</style>
