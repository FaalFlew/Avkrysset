<script setup lang="ts">
/**
 * TaskList — the "Tasks" card at the bottom of the analytics page: every task of the range,
 * grouped by day (local date of the start) with subtotals and a grand total that equals the KPIs.
 * Search (title) and a category filter (chips; the donut sets it too) narrow the list; 100 rows
 * show at a time ("Show more"); printing shows every matching row up to 5,000 (like the PDF, with
 * its note), plus a note when filtered. Wide cards (and paper) get a table, narrow cards a list of
 * cards (TaskListCards). While a new range loads, the previous rows stay (dimmed) and the caption
 * says "Updating…" and which range is still shown.
 * Props:
 *   rows: TaskListRow[] — every task of the range, in list order (src/lib/taskList.ts)
 *   loading?: boolean — first load (skeleton)
 *   refetching?: boolean — previous rows on screen while a new range loads
 *   dim?: boolean — dim the stale rows (default: refetching; off while the whole page is dimmed)
 *   error?: string | null — the last load failed (error state with Retry)
 *   scopeLabel: string — range label of the rows ON SCREEN ("Jan – Dec 2026")
 *   category: string | null — v-model:category, the category filter (analytics category id)
 * Emits: open(row) (open the task in the editor), retry(), update:category(id | null)
 * Exposes: reveal() — scroll the card into view and move focus to it (after a donut click)
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ListTodo, Search, SearchX, X } from "lucide-vue-next";
import { UiButton, UiCard, UiEmptyState, UiErrorState, UiIconButton, UiInput, UiSkeleton, UiSpinner } from "@/components/ui";
import { formatCount, formatDuration, pluralize } from "@/lib/format";
import {
  TASK_LIST_PAGE_SIZE,
  filterTaskListRows,
  groupTaskListRows,
  isFiltered,
  pageTaskListDays,
  taskListCategories,
  taskListTotals,
  type TaskListRow,
} from "@/lib/taskList";
import { printState } from "@/composables/usePrintMode";
import { useBreakpoint } from "@/composables/useMediaQuery";
import TaskListTable from "./TaskListTable.vue";
import TaskListCards from "./TaskListCards.vue";
import { PRINT_ROW_CAP, taskListLayout } from "./taskListView";

const props = withDefaults(
  defineProps<{
    rows: TaskListRow[];
    loading?: boolean;
    refetching?: boolean;
    dim?: boolean;
    error?: string | null;
    scopeLabel: string;
    category: string | null;
  }>(),
  { loading: false, refetching: false, dim: undefined, error: null }
);

const emit = defineEmits<{
  open: [row: TaskListRow];
  retry: [];
  "update:category": [id: string | null];
}>();

const query = ref("");
const limit = ref(TASK_LIST_PAGE_SIZE);

const filter = computed(() => ({ query: query.value, categoryId: props.category }));
const filtered = computed(() => isFiltered(filter.value));
const matching = computed(() => filterTaskListRows(props.rows, filter.value));

const allTotals = computed(() => taskListTotals(props.rows));
const matchingTotals = computed(() => taskListTotals(matching.value));
const days = computed(() => groupTaskListRows(matching.value));

/** Paper shows the matching rows up to PRINT_ROW_CAP (like the PDF); screens page by TASK_LIST_PAGE_SIZE. */
const printing = computed(() => printState.active);
const rowLimit = computed(() => (printing.value ? PRINT_ROW_CAP : limit.value));
const pageDays = computed(() => pageTaskListDays(days.value, rowLimit.value));
const shownCount = computed(() => Math.min(matching.value.length, rowLimit.value));
const remaining = computed(() => matching.value.length - shownCount.value);
/** More matching rows than paper shows: the note points to the CSV for the complete list. */
const overPrintCap = computed(() => matching.value.length > PRINT_ROW_CAP);
const dimmed = computed(() => props.dim ?? props.refetching);

const showOrganization = computed(() => props.rows.some((row) => !!row.organizationName));
const chips = computed(() => taskListCategories(props.rows));

const pageAnnouncement = ref("");

// A new range or filter starts at the first page again (edits keep the expanded list).
watch([() => props.scopeLabel, query, () => props.category], () => {
  limit.value = TASK_LIST_PAGE_SIZE;
  pageAnnouncement.value = "";
});

type State = "loading" | "error" | "empty" | "no-match" | "ready";
const state = computed<State>(() => {
  if (props.error) return "error";
  if (props.loading) return "loading";
  if (props.rows.length === 0) return "empty";
  if (matching.value.length === 0) return "no-match";
  return "ready";
});

/** Describes the rows on screen: their totals, or (while a new range loads) which range they are. */
const caption = computed(() => {
  if (state.value !== "ready" && state.value !== "no-match") return undefined;
  if (props.refetching) return `Updating… still showing ${props.scopeLabel}`;
  return `${pluralize(allTotals.value.count, "task")} · ${formatDuration(allTotals.value.hours)}`;
});

const tableCaption = computed(
  () =>
    `Tasks, ${props.scopeLabel}${filtered.value ? ` (filtered: ${filterDescription.value})` : ""}` +
    (props.refetching ? ", updating" : "")
);

const selectedChip = computed(() => chips.value.find((c) => c.id === props.category) ?? null);

/** "“standup” · Work" — the active filters in words. */
const filterDescription = computed(() => {
  const parts: string[] = [];
  const q = query.value.trim();
  if (q) parts.push(`“${q}”`);
  if (props.category !== null) parts.push(selectedChip.value?.name ?? "selected category");
  return parts.join(" · ");
});

/** Polite announcement of the filter result and of updates (screen readers). */
const liveText = computed(() => {
  if (props.refetching && (state.value === "ready" || state.value === "no-match")) return "Updating tasks";
  if (state.value === "no-match") return "No tasks match the filters";
  if (state.value !== "ready" || !filtered.value) return "";
  return `${formatCount(matching.value.length)} of ${pluralize(props.rows.length, "task")} shown`;
});

function selectCategory(id: string | null): void {
  emit("update:category", id === props.category ? null : id);
}

function clearFilters(): void {
  query.value = "";
  emit("update:category", null);
}

const listRef = ref<{ focusRow: (id: string) => boolean } | null>(null);

async function showMore(): Promise<void> {
  const firstNew = matching.value[shownCount.value];
  limit.value += TASK_LIST_PAGE_SIZE;
  pageAnnouncement.value = `Showing ${formatCount(shownCount.value)} of ${pluralize(matching.value.length, "task")}`;
  // Keep keyboard users in place: focus the first newly shown task.
  await nextTick();
  if (firstNew) listRef.value?.focusRow(firstNew.id);
}

const cardRef = ref<InstanceType<typeof UiCard> | null>(null);
const root = computed<HTMLElement | null>(() => (cardRef.value?.$el as HTMLElement | undefined) ?? null);
const { isMobile, prefersReducedMotion } = useBreakpoint();

function focusCard(): void {
  root.value?.focus?.({ preventScroll: true });
}

// --- Layout: the card's own width decides (phones are narrow from the first render) ----------
const cardWidth = ref<number | null>(null);
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  const el = root.value;
  if (!el || typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver((entries) => {
    const width = entries[entries.length - 1]?.contentRect.width;
    if (typeof width === "number") cardWidth.value = width;
  });
  resizeObserver.observe(el);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

const layout = computed(() =>
  taskListLayout({ printing: printing.value, cardWidth: cardWidth.value, isMobile: isMobile.value })
);

// --- Retry: focus must not fall back to <body> when the error state goes away -----------------
let focusAfterRetry = false;
function onRetry(): void {
  focusAfterRetry = true;
  emit("retry");
}
watch(
  state,
  async (now) => {
    if (!focusAfterRetry || now === "error") return; // a failed retry keeps focus on "Try again"
    focusAfterRetry = false;
    await nextTick();
    // Loaded: the first task; otherwise (still loading, empty, no match) the card itself.
    const first = now === "ready" ? matching.value[0] : undefined;
    if (!first || !listRef.value?.focusRow(first.id)) focusCard();
  },
  { flush: "post" }
);

/** Bring the list into view (a category was picked in the donut) and move focus to it. */
function reveal(): void {
  const el = root.value;
  if (!el) return;
  focusCard();
  el.scrollIntoView?.({ behavior: prefersReducedMotion.value ? "auto" : "smooth", block: "start" });
}

defineExpose({ reveal });
</script>

<template>
  <UiCard
    ref="cardRef"
    title="Tasks"
    :caption="caption"
    class="task-list"
    tabindex="-1"
    :aria-busy="loading || refetching || undefined"
    :data-layout="layout"
  >
    <template #actions>
      <UiSpinner v-if="refetching" :size="14" />
    </template>

    <p class="sr-only" role="status" aria-live="polite">{{ liveText }}</p>
    <p class="sr-only" role="status" aria-live="polite">{{ pageAnnouncement }}</p>

    <!-- Filters (screen only) -->
    <div v-if="state !== 'loading' && state !== 'error' && state !== 'empty'" class="toolbar" data-print-hide>
      <UiInput
        v-model="query"
        class="toolbar__search"
        type="search"
        label="Search tasks"
        hide-label
        placeholder="Search by title"
        autocomplete="off"
        enterkeyhint="search"
      >
        <template #leading><Search :size="16" /></template>
        <template v-if="query" #trailing>
          <UiIconButton label="Clear search" size="sm" :tooltip="false" @click="query = ''">
            <X :size="14" />
          </UiIconButton>
        </template>
      </UiInput>

      <div class="chips" role="group" aria-label="Filter by category">
        <button
          type="button"
          class="chip"
          :class="{ 'is-selected': category === null }"
          :aria-pressed="category === null"
          @click="selectCategory(null)"
        >
          All
        </button>
        <button
          v-for="chip in chips"
          :key="chip.id"
          type="button"
          class="chip"
          :class="{ 'is-selected': category === chip.id }"
          :aria-pressed="category === chip.id"
          :title="`${chip.name} · ${pluralize(chip.count, 'task')} · ${formatDuration(chip.hours)}`"
          @click="selectCategory(chip.id)"
        >
          <span
            class="chip__dot"
            :style="{ backgroundColor: chip.color || 'var(--chart-neutral)' }"
            aria-hidden="true"
          ></span>
          <span class="chip__name">{{ chip.name }}</span>
          <span class="chip__count">{{ formatCount(chip.count) }}</span>
        </button>
      </div>

      <UiButton v-if="filtered" variant="ghost" size="sm" class="toolbar__clear" @click="clearFilters">
        <template #leading><X :size="14" /></template>
        Clear filters
      </UiButton>
    </div>

    <p v-if="filtered && state === 'ready'" class="print-note print-only">
      Filtered: {{ filterDescription }} — {{ formatCount(matching.length) }} of {{ pluralize(rows.length, "task") }}
    </p>
    <p v-if="overPrintCap && state === 'ready'" class="print-note print-cap-note print-only">
      Showing the first {{ formatCount(PRINT_ROW_CAP) }} of {{ pluralize(matching.length, "task") }} — use Task list
      (CSV) for the complete list.
    </p>

    <div v-if="state === 'loading'" class="skeleton" aria-hidden="true">
      <div class="skeleton__toolbar"><UiSkeleton :width="240" :height="32" radius="var(--radius-md)" /></div>
      <div class="skeleton__day"><UiSkeleton :width="180" :height="12" /></div>
      <div v-for="i in 6" :key="i" class="skeleton__row">
        <UiSkeleton :width="96" :height="12" />
        <UiSkeleton :width="`${60 - i * 5}%`" :height="12" />
        <UiSkeleton :width="72" :height="12" />
      </div>
      <span class="sr-only">Loading tasks…</span>
    </div>

    <UiErrorState
      v-else-if="state === 'error'"
      size="sm"
      :heading-level="3"
      title="Couldn't load the tasks"
      description="Check your connection and try again."
      :retrying="loading || refetching"
      @retry="onRetry"
    />

    <UiEmptyState
      v-else-if="state === 'empty'"
      size="sm"
      :heading-level="3"
      :icon="ListTodo"
      title="No tasks in this range"
    />

    <UiEmptyState
      v-else-if="state === 'no-match'"
      size="sm"
      :heading-level="3"
      :icon="SearchX"
      title="No tasks match"
      :description="`Nothing in this range matches ${filterDescription}.`"
    >
      <template #actions>
        <UiButton variant="secondary" size="sm" @click="clearFilters">Clear filters</UiButton>
      </template>
    </UiEmptyState>

    <template v-else>
      <div class="task-list__body" :class="{ 'is-refetching': dimmed }">
        <TaskListTable
          v-if="layout === 'table'"
          ref="listRef"
          :days="pageDays"
          :caption="tableCaption"
          :show-organization="showOrganization"
          :totals="matchingTotals"
          :all-count="rows.length"
          :filtered="filtered"
          @open="emit('open', $event)"
        />
        <TaskListCards
          v-else
          ref="listRef"
          :days="pageDays"
          :totals="matchingTotals"
          :all-count="rows.length"
          :filtered="filtered"
          @open="emit('open', $event)"
        />
      </div>

      <div v-if="remaining > 0 && !printing" class="more" data-print-hide>
        <p class="more__status">Showing {{ formatCount(shownCount) }} of {{ pluralize(matching.length, "task") }}</p>
        <UiButton variant="secondary" @click="showMore">
          Show {{ formatCount(Math.min(remaining, TASK_LIST_PAGE_SIZE)) }} more
        </UiButton>
      </div>
    </template>
  </UiCard>
</template>

<style scoped>
.task-list {
  container: tasklist / inline-size;
  min-width: 0;
  scroll-margin-top: var(--space-4);
}
.task-list:focus {
  outline: none;
}
.task-list:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.task-list__body {
  transition: opacity var(--dur-base) var(--ease-standard);
}
.is-refetching {
  opacity: 0.6;
}

/* ---------- Toolbar ---------- */
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-2);
}
.toolbar__search {
  flex: 0 1 280px;
  min-width: 200px;
}
.toolbar__clear {
  margin-inline-start: auto;
}

.chips {
  display: flex;
  flex: 1 1 320px;
  flex-wrap: wrap;
  gap: var(--space-1-5);
  min-width: 0;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  max-width: 100%;
  min-height: 32px;
  padding: 0 var(--space-2-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background-color: var(--bg-surface);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.chip:hover {
  background-color: var(--bg-subtle);
  color: var(--text-primary);
}
.chip.is-selected {
  border-color: var(--accent-border);
  background-color: var(--accent-subtle);
  color: var(--accent-text);
}
.chip__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}
.chip__name {
  min-width: 0;
  max-width: 18ch;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip__count {
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
}
.chip.is-selected .chip__count {
  color: inherit;
  opacity: 0.8;
}

@media (pointer: coarse) {
  .chip {
    min-height: 40px;
  }
}

/* Narrow card: the chips scroll sideways instead of stacking up. */
@container tasklist (max-width: 759.98px) {
  .toolbar__search {
    flex: 1 1 100%;
  }
  .chips {
    flex: 1 1 100%;
    flex-wrap: nowrap;
    overflow-x: auto;
    margin: 0 calc(-1 * var(--space-4));
    padding: var(--space-0-5) var(--space-4);
    scrollbar-width: none;
    scroll-padding-inline: var(--space-4);
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex-shrink: 0;
  }
  .toolbar__clear {
    margin-inline-start: 0;
  }
}

/* ---------- Paging ---------- */
.more {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--space-2) var(--space-4);
  margin-top: var(--space-4);
}
.more__status {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* ---------- Skeleton ---------- */
.skeleton {
  display: flex;
  flex-direction: column;
}
.skeleton__toolbar {
  margin-bottom: var(--space-4);
}
.skeleton__day {
  display: flex;
  align-items: center;
  height: 32px;
  border-bottom: 1px solid var(--border-subtle);
}
.skeleton__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-4);
  height: 40px;
  border-bottom: 1px solid var(--border-subtle);
}

/* ---------- Paper ---------- */
.print-note {
  margin-bottom: var(--space-2);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-secondary);
}
@media print {
  .print-note {
    display: block;
  }
  .is-refetching {
    opacity: 1;
  }
}
</style>
