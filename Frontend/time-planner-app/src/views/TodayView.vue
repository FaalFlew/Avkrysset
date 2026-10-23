<!-- src/views/TodayView.vue -->
<script setup lang="ts">
/**
 * Today — the day at a glance: summary + progress, a Now/Next card and a timeline whose rows
 * open the editor. A "Now" divider separates past from upcoming; free gaps of 30 min or more
 * offer to add a task there.
 * Data: guests derive the list from the store's tasks (always current); signed-in users load the
 * day (own loading/error flags) and the store patches the list after every save/delete.
 */
import { computed, onMounted, watch } from "vue";
import { storeToRefs } from "pinia";
import { CalendarPlus, Plus } from "lucide-vue-next";
import type { Task } from "@/types";
import UiPageHeader from "@/components/ui/UiPageHeader.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiKbd from "@/components/ui/UiKbd.vue";
import UiCard from "@/components/ui/UiCard.vue";
import UiBadge from "@/components/ui/UiBadge.vue";
import UiEmptyState from "@/components/ui/UiEmptyState.vue";
import UiErrorState from "@/components/ui/UiErrorState.vue";
import UiSkeleton from "@/components/ui/UiSkeleton.vue";
import { useTaskStore } from "@/stores/taskStore";
import { useAuthStore } from "@/stores/authStore";
import { useNow, useToday } from "@/composables/useClock";
import { useTaskEditor } from "@/composables/useTaskEditor";
import { useBreakpoint } from "@/composables/useMediaQuery";
import { useHotkeyScope } from "@/composables/useHotkeys";
import { useTheme } from "@/composables/useTheme";
import {
  compareInstants,
  dayRange,
  diffMinutes,
  endInstant,
  formatDate,
  formatDurationMinutes,
  formatTime,
  isInRange,
  toEpochMs,
  type UtcIsoString,
} from "@/lib/datetime";
import { displayTitle, formatEndDayMarker, nextQuarterHour, taskEndDayOffset } from "@/lib/plannerFormat";
import { isOrgTask, organizationLabel, orgMonogram, overlapIndex } from "@/lib/taskAccess";
import { pluralize } from "@/lib/format";
import { OTHER_COLOR } from "@/lib/categoryPalette";
import { blockEdgeColor, isHex } from "@/lib/color";

const taskStore = useTaskStore();
const authStore = useAuthStore();
const editor = useTaskEditor();
const { isCoarse, isMobile } = useBreakpoint();
const { resolvedTheme } = useTheme();
const { tasks, todayTasks, todayTasksDay, isLoadingToday, todayError } = storeToRefs(taskStore);
const isAuthenticated = computed(() => authStore.isAuthenticated);

const today = useToday();
const now = useNow();

function load(): void {
  if (isAuthenticated.value) void taskStore.fetchTodayTasks(today.value);
}
onMounted(load);
watch([today, isAuthenticated], load);

useHotkeyScope({
  t: () => {
    document.querySelector<HTMLElement>(".timeline-row.is-current, .now-divider")?.scrollIntoView({ block: "center" });
  },
});

// ------------------------------------------------------------------ data
const dayTasks = computed<Task[]>(() => {
  const range = dayRange(today.value);
  const source = isAuthenticated.value
    ? todayTasksDay.value === today.value
      ? todayTasks.value
      : []
    : tasks.value;
  return source.filter((t) => isInRange(t.start, range)).sort((a, b) => compareInstants(a.start, b.start));
});

const isFirstLoad = computed(
  () => isAuthenticated.value && todayTasksDay.value !== today.value && !todayError.value
);
const showError = computed(() => isAuthenticated.value && !!todayError.value && dayTasks.value.length === 0);

/** Category color for the row bar, adjusted per theme to stay visible (≥ 3:1) on the page. */
function colorOf(task: Task): string {
  const raw = taskStore.getCategoryById(task.categoryId)?.color ?? task.categoryColor ?? OTHER_COLOR;
  return isHex(raw) ? blockEdgeColor(raw, resolvedTheme.value) : raw;
}
function categoryNameOf(task: Task): string {
  return taskStore.getCategoryById(task.categoryId)?.name ?? task.categoryName;
}

interface Row {
  task: Task;
  end: UtcIsoString;
  status: "past" | "current" | "upcoming";
}

const rows = computed<Row[]>(() =>
  dayTasks.value.map((task) => {
    const end = endInstant(task.start, task.duration);
    const startMs = toEpochMs(task.start);
    const endMs = toEpochMs(end);
    const status = endMs <= now.value ? "past" : startMs <= now.value ? "current" : "upcoming";
    return { task, end, status };
  })
);

type TimelineItem =
  | { kind: "task"; key: string; row: Row }
  | { kind: "now"; key: string }
  | { kind: "gap"; key: string; start: UtcIsoString; minutes: number };

const timeline = computed<TimelineItem[]>(() => {
  const items: TimelineItem[] = [];
  let nowPlaced = false;
  const placeNow = () => {
    if (!nowPlaced) items.push({ kind: "now", key: "now" });
    nowPlaced = true;
  };
  // Latest end so far: with overlapping tasks (org tasks may overlap personal ones, Q3) the
  // free time starts when *all* earlier tasks are over, not when the previous row ends.
  let busyUntilMs = Number.NEGATIVE_INFINITY;
  let busyUntil: UtcIsoString | null = null;
  rows.value.forEach((row, index) => {
    if (row.status === "upcoming") placeNow();
    items.push({ kind: "task", key: row.task.id, row });
    if (toEpochMs(row.end) > busyUntilMs) {
      busyUntilMs = toEpochMs(row.end);
      busyUntil = row.end;
    }
    const next = rows.value[index + 1];
    if (!next || busyUntil === null) return;
    // Free time between this task and the next (only what is still ahead of us).
    const gapStartMs = Math.max(busyUntilMs, now.value);
    const gapEndMs = toEpochMs(next.task.start);
    if (gapEndMs - busyUntilMs < 30 * 60_000 || gapEndMs <= now.value) return;
    const ongoing = busyUntilMs < now.value;
    const start = ongoing ? nextQuarterHour(gapStartMs) : busyUntil;
    const minutes = diffMinutes(next.task.start, start);
    if (minutes < 15) return;
    // Shown gaps always lie ahead, so "now" comes before them.
    placeNow();
    items.push({ kind: "gap", key: `gap-${row.task.id}`, start, minutes });
  });
  if (rows.value.length > 0) placeNow();
  return items;
});

// ------------------------------------------------------------------ summary
const plannedMinutes = computed(() => dayTasks.value.reduce((sum, t) => sum + t.duration * 60, 0));
const leftMinutes = computed(() =>
  rows.value.reduce((sum, row) => {
    const from = Math.max(toEpochMs(row.task.start), now.value);
    return sum + Math.max(0, (toEpochMs(row.end) - from) / 60_000);
  }, 0)
);
const progress = computed(() =>
  plannedMinutes.value > 0 ? Math.min(1, Math.max(0, 1 - leftMinutes.value / plannedMinutes.value)) : 0
);
const summary = computed(
  () =>
    `${pluralize(dayTasks.value.length, "task")} · ${formatDurationMinutes(plannedMinutes.value)} planned · ${formatDurationMinutes(leftMinutes.value)} left`
);

const focusLine = computed(() => {
  const current = rows.value.find((r) => r.status === "current");
  if (current) {
    const left = formatDurationMinutes((toEpochMs(current.end) - now.value) / 60_000);
    return { label: "Now", text: `${displayTitle(current.task.title)} · until ${formatEndClock(current.task)} (${left} left)` };
  }
  const next = rows.value.find((r) => r.status === "upcoming");
  if (next) {
    const inText = formatDurationMinutes((toEpochMs(next.task.start) - now.value) / 60_000);
    return { label: "Next", text: `${displayTitle(next.task.title)} at ${formatTime(next.task.start)} (in ${inText})` };
  }
  return { label: "", text: "That's everything for today." };
});

const headerDate = computed(() => formatDate(today.value, "weekday"));
const nowLabel = computed(() => formatTime(now.value));

// ------------------------------------------------------------------ actions
function addTask(): void {
  editor.openCreate();
}
function openTask(task: Task, event: MouseEvent): void {
  editor.openEdit(task, (event.currentTarget as HTMLElement | null)?.getBoundingClientRect() ?? null);
}
function fillGap(start: UtcIsoString, minutes: number, event: MouseEvent): void {
  editor.openCreate({
    start,
    durationH: Math.min(minutes, 60) / 60,
    anchorRect: (event.currentTarget as HTMLElement | null)?.getBoundingClientRect() ?? null,
  });
}
/**
 * End clock time, marking a later end day: "14:00 +1d" (visible) or "Thursday 14:00" (`spoken`).
 */
function formatEndClock(task: Task, spoken = false): string {
  const end = endInstant(task.start, task.duration);
  if (taskEndDayOffset(task.start, task.duration) === 0) return formatTime(end);
  return spoken
    ? `${formatDate(end, "weekday")} ${formatTime(end)}`
    : `${formatTime(end)} ${formatEndDayMarker(task.start, task.duration)}`;
}

/** Tasks each task overlaps (shown as "Overlaps …" on the row). */
const overlapsByTask = computed(() => overlapIndex(dayTasks.value));
function overlapText(task: Task): string {
  const others = overlapsByTask.value.get(task.id) ?? [];
  if (others.length === 0) return "";
  const names = others.map((o) => displayTitle(o.title));
  return `Overlaps ${names.length === 1 ? names[0] : `${names.length} tasks`}`;
}
function orgOf(task: Task): string | null {
  return isOrgTask(task) ? organizationLabel(task) : null;
}

function rowLabel(row: Row): string {
  const status = row.status === "current" ? ", in progress" : row.status === "past" ? ", done" : "";
  const org = orgOf(row.task);
  const extras = [org ? `${org} task` : "", overlapText(row.task).replace(/^Overlaps/, "overlaps")].filter(Boolean);
  return `${displayTitle(row.task.title)}, ${formatTime(row.task.start)} to ${formatEndClock(row.task, true)}, ${formatDurationMinutes(row.task.duration * 60)}, ${categoryNameOf(row.task)}${extras.length ? `, ${extras.join(", ")}` : ""}${status}`;
}
</script>

<template>
  <div class="today">
    <UiPageHeader eyebrow="Today" :title="headerDate" size="lg">
      <!-- Phones already have the floating "New task" button. -->
      <template v-if="!isMobile" #actions>
        <UiButton variant="secondary" @click="addTask">
          <template #leading><Plus :size="16" /></template>
          Add task
          <template v-if="!isCoarse" #trailing><UiKbd :keys="['N']" /></template>
        </UiButton>
      </template>
    </UiPageHeader>

    <!-- Loading -->
    <div v-if="isFirstLoad" class="today__loading" aria-busy="true">
      <span class="sr-only" role="status">Loading today's tasks</span>
      <div v-for="i in 3" :key="i" class="skeleton-row">
        <UiSkeleton :width="44" :height="12" />
        <UiSkeleton :width="3" :height="40" radius="var(--radius-full)" />
        <div class="skeleton-row__text">
          <UiSkeleton width="60%" :height="14" />
          <UiSkeleton width="35%" :height="12" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <UiErrorState
      v-else-if="showError"
      title="Couldn't load today's plan"
      description="Check your connection and try again."
      :retrying="isLoadingToday"
      @retry="load"
    />

    <!-- Empty -->
    <UiEmptyState
      v-else-if="dayTasks.length === 0"
      :icon="CalendarPlus"
      title="Nothing planned for today"
      description="Block out time for what matters most — start with one task."
      class="today__empty"
    >
      <template #actions>
        <UiButton variant="primary" @click="addTask">Add a task</UiButton>
        <UiButton variant="ghost" to="/">Open planner</UiButton>
      </template>
    </UiEmptyState>

    <template v-else>
      <section class="today__summary" aria-label="Summary">
        <p class="today__summary-text tabular">{{ summary }}</p>
        <div
          class="progress"
          role="progressbar"
          aria-label="Planned time elapsed today"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(progress * 100)"
        >
          <span class="progress__fill" :style="{ transform: `scaleX(${progress})` }" />
        </div>
      </section>

      <UiCard padding="md" as="section" class="focus-card" aria-label="Now and next">
        <p class="focus-card__text">
          <strong v-if="focusLine.label" class="focus-card__label">{{ focusLine.label }} ·</strong>
          {{ focusLine.text }}
        </p>
      </UiCard>

      <ol class="timeline" role="list" aria-label="Today's tasks">
        <li v-for="item in timeline" :key="item.key" class="timeline__item">
          <button
            v-if="item.kind === 'task'"
            type="button"
            class="timeline-row"
            :class="`is-${item.row.status}`"
            :aria-label="rowLabel(item.row)"
            @click="openTask(item.row.task, $event)"
          >
            <span class="timeline-row__times tabular" aria-hidden="true">
              <span class="timeline-row__start">{{ formatTime(item.row.task.start) }}</span>
              <span class="timeline-row__end">{{ formatEndClock(item.row.task) }}</span>
            </span>
            <span class="timeline-row__bar" :style="{ backgroundColor: colorOf(item.row.task) }" aria-hidden="true" />
            <span class="timeline-row__main" aria-hidden="true">
              <span class="timeline-row__title" :title="displayTitle(item.row.task.title)">
                <span v-if="orgOf(item.row.task)" class="org-badge" :title="orgOf(item.row.task) ?? undefined">{{
                  orgMonogram(orgOf(item.row.task))
                }}</span>
                {{ displayTitle(item.row.task.title) }}
              </span>
              <span class="timeline-row__meta tabular">
                {{ formatDurationMinutes(item.row.task.duration * 60) }} · {{ categoryNameOf(item.row.task) }}
                <template v-if="orgOf(item.row.task)"> · {{ orgOf(item.row.task) }}</template>
              </span>
              <span v-if="overlapText(item.row.task)" class="timeline-row__overlap">{{ overlapText(item.row.task) }}</span>
            </span>
            <UiBadge v-if="item.row.status === 'current'" tone="accent" class="timeline-row__badge">Now</UiBadge>
          </button>

          <div v-else-if="item.kind === 'now'" class="now-divider" role="separator" :aria-label="`Now, ${nowLabel}`">
            <span class="now-divider__label tabular">Now · {{ nowLabel }}</span>
            <span class="now-divider__line" />
          </div>

          <button
            v-else
            type="button"
            class="gap-row"
            :aria-label="`Free time, ${formatDurationMinutes(item.minutes)} from ${formatTime(item.start)}. Add a task here`"
            @click="fillGap(item.start, item.minutes, $event)"
          >
            <span class="gap-row__times tabular" aria-hidden="true">{{ formatTime(item.start) }}</span>
            <span class="gap-row__label" aria-hidden="true">
              Free · {{ formatDurationMinutes(item.minutes) }}
              <span class="gap-row__add"><Plus :size="14" /> Add task</span>
            </span>
          </button>
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped>
.today {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  width: 100%;
  max-width: var(--content-narrow);
  margin: 0 auto;
  padding: var(--space-8) var(--space-6) var(--space-12);
}
@media (max-width: 767.98px) {
  .today {
    padding: var(--space-5) var(--space-4) calc(var(--space-16) + var(--space-8));
  }
}

.today__loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.skeleton-row__text {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.today__empty {
  margin-top: var(--space-10);
}

.today__summary {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: calc(var(--space-2) * -1);
}
.today__summary-text {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
.progress {
  position: relative;
  height: 4px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background-color: var(--bg-muted);
}
.progress__fill {
  position: absolute;
  inset: 0;
  background-color: var(--chart-bar);
  transform-origin: left center;
  transition: transform var(--dur-base) var(--ease-standard);
}

.focus-card__text {
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.focus-card__label {
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.timeline-row {
  display: flex;
  align-items: stretch;
  gap: var(--space-3);
  width: 100%;
  min-height: 56px;
  padding: var(--space-2-5) var(--space-3) var(--space-2-5) var(--space-2);
  border-radius: var(--radius-md);
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-standard);
}
.timeline-row:hover {
  background-color: var(--bg-subtle);
}
.timeline-row__times {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 56px;
  padding-top: 1px;
  text-align: right;
}
.timeline-row__start {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
.timeline-row__end {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}
.timeline-row__bar {
  flex-shrink: 0;
  width: 3px;
  border-radius: var(--radius-full);
}
.timeline-row__main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.timeline-row__title {
  font-size: var(--fs-15);
  line-height: var(--lh-15);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.org-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  margin-right: var(--space-1-5);
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background-color: var(--bg-muted);
  color: var(--text-secondary);
  font-size: var(--fs-11);
  line-height: 1;
  font-weight: var(--fw-semibold);
  vertical-align: 2px;
}
.timeline-row__overlap {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--warning-text);
}
.timeline-row__meta {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
.timeline-row.is-past .timeline-row__title {
  color: var(--text-secondary);
}
.timeline-row__badge {
  align-self: center;
  flex-shrink: 0;
}

.now-divider {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0 var(--space-1) var(--space-2);
}
.now-divider__label {
  flex-shrink: 0;
  width: 56px;
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-semibold);
  /* Text uses --danger-text (5.6:1 light, ≥ 7:1 dark); --now (3.9:1) is for the line only. */
  color: var(--danger-text);
  text-align: right;
  white-space: nowrap;
}
.now-divider__line {
  flex: 1 1 auto;
  height: 2px;
  border-radius: var(--radius-full);
  background-color: var(--now);
}

.gap-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 40px;
  padding: var(--space-1-5) var(--space-3) var(--space-1-5) var(--space-2);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.gap-row__times {
  flex-shrink: 0;
  width: 56px;
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  text-align: right;
}
.gap-row__label {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-left: calc(3px + var(--space-3));
  font-size: var(--fs-13);
  line-height: var(--lh-13);
}
.gap-row__add {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--accent-text);
  font-weight: var(--fw-medium);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-standard);
}
.gap-row:hover,
.gap-row:focus-visible {
  background-color: var(--bg-subtle);
  color: var(--text-secondary);
}
.gap-row:hover .gap-row__add,
.gap-row:focus-visible .gap-row__add {
  opacity: 1;
}
@media (hover: none), (pointer: coarse) {
  .gap-row__add {
    opacity: 1;
  }
}
</style>
