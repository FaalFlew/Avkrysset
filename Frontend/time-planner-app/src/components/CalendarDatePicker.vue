<!-- src/components/CalendarDatePicker.vue -->
<script setup lang="ts">
/**
 * CalendarDatePicker — pick a week by its ISO week number.
 * Header "‹ 2026 ▾ ›": the arrows step the year; the year button switches to a year grid
 * (12 years, ‹ › page by 12), and picking a year returns to that year's weeks.
 * Body: every ISO week (52 or 53) of the ISO week-year; selected week = accent fill, this week =
 * accent text + dot. A caption under the grid shows the focused/hovered week's dates (falls back
 * to the selected week), so touch users see them too; each week also has an aria-label/tooltip
 * "Week 41 · Oct 5 – 11, 2026".
 * Selecting week N of year Y sets uiStore.currentDate to that week's day with the current
 * weekday (the 7-day planner shows the week; the phone day view keeps its weekday) and emits
 * `select`.
 * Props:
 *   compact?: boolean — sidebar density
 *   autofocus?: boolean — mark the focused cell [data-autofocus] so a popover/sheet that opens
 *     the picker focuses the selected week
 * Keyboard (role="grid", roving tabindex): ←/→ ±1 week (crossing years), ↑/↓ ±1 row, Home/End
 * first/last week, PageUp/PageDown previous/next year, Enter/Space select. Year grid: arrows,
 * Home/End, PageUp/PageDown ±12 years, Enter/Space choose. Esc closes the surrounding popover.
 * Exposes focusGrid().
 */
import { computed, nextTick, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-vue-next";
import UiIconButton from "@/components/ui/UiIconButton.vue";
import { useUIStore } from "@/stores/uiStore";
import { useToday } from "@/composables/useClock";
import { useBreakpoint } from "@/composables/useMediaQuery";
import { isoWeekOf, isoWeeksInYear, type DateKey } from "@/lib/datetime";
import {
  MIN_PICKER_YEAR,
  YEAR_COLUMNS,
  moveWeekFocus,
  moveYearFocus,
  selectWeekDate,
  weekCells,
  weekLabel,
  yearPage,
  yearPageStart,
  type WeekCell,
} from "@/components/planner/weekPicker";

const props = withDefaults(defineProps<{ compact?: boolean; autofocus?: boolean }>(), {
  compact: false,
  autofocus: false,
});
const emit = defineEmits<{ select: [day: DateKey] }>();

const uiStore = useUIStore();
const { currentDate } = storeToRefs(uiStore);
const today = useToday();
const { isCoarse } = useBreakpoint();

const selected = computed(() => isoWeekOf(currentDate.value));
const thisWeek = computed(() => isoWeekOf(today.value));

const view = ref<"weeks" | "years">("weeks");
/** ISO week-year shown in the week grid. */
const viewYear = ref(selected.value.isoYear);
/** Roving-focus week (in `viewYear`). */
const focusedWeek = ref(selected.value.week);
const hoveredWeek = ref<number | null>(null);
const gridHasFocus = ref(false);
/** Year grid. */
const pageStart = ref(yearPageStart(viewYear.value));
const focusedYear = ref(viewYear.value);

const gridRef = ref<HTMLElement | null>(null);

// Follow the planner (Today button, J/K, drags across weeks...).
watch(currentDate, () => {
  viewYear.value = selected.value.isoYear;
  focusedWeek.value = selected.value.week;
  view.value = "weeks";
});

/** Sidebar on touch screens: 5 columns keep the targets ≥ 40px wide. */
const columns = computed(() => (props.compact && isCoarse.value ? 5 : 7));
const cells = computed(() => weekCells(viewYear.value));
const rows = computed(() => {
  const out: WeekCell[][] = [];
  for (let i = 0; i < cells.value.length; i += columns.value) out.push(cells.value.slice(i, i + columns.value));
  return out;
});
const years = computed(() => yearPage(pageStart.value));
const yearRows = computed(() => {
  const out: number[][] = [];
  for (let i = 0; i < years.value.length; i += YEAR_COLUMNS) out.push(years.value.slice(i, i + YEAR_COLUMNS));
  return out;
});

function isSelected(week: number): boolean {
  return selected.value.isoYear === viewYear.value && selected.value.week === week;
}
function isThisWeek(week: number): boolean {
  return thisWeek.value.isoYear === viewYear.value && thisWeek.value.week === week;
}
function cellLabel(cell: WeekCell): string {
  return isThisWeek(cell.week) ? `${cell.label}, this week` : cell.label;
}

/**
 * Caption: hovered → focused (while the grid has focus) → selected (if shown). When browsing a
 * year that doesn't contain the selected week, show the year's week count rather than an
 * arbitrary week's dates (which would read as if that week were selected).
 */
const captionWeek = computed<number | null>(() => {
  if (hoveredWeek.value !== null) return hoveredWeek.value;
  if (gridHasFocus.value) return focusedWeek.value;
  if (selected.value.isoYear === viewYear.value) return selected.value.week;
  return null;
});
const caption = computed(() => {
  const weeks = isoWeeksInYear(viewYear.value);
  return captionWeek.value === null
    ? `${viewYear.value} · ${weeks} weeks`
    : weekLabel(viewYear.value, Math.min(captionWeek.value, weeks));
});

const yearButtonLabel = computed(() =>
  view.value === "weeks" ? `Change year, ${viewYear.value}` : `Show the weeks of ${viewYear.value}`
);
const canGoBack = computed(() =>
  view.value === "weeks" ? viewYear.value > MIN_PICKER_YEAR : pageStart.value > MIN_PICKER_YEAR
);

// ------------------------------------------------------------------ actions
function selectWeek(week: number): void {
  focusedWeek.value = week;
  const day = selectWeekDate(viewYear.value, week, currentDate.value);
  currentDate.value = day;
  emit("select", day);
}

function showYear(year: number): void {
  viewYear.value = Math.max(MIN_PICKER_YEAR, year);
  focusedWeek.value = Math.min(focusedWeek.value, isoWeeksInYear(viewYear.value));
}

function stepBack(): void {
  if (view.value === "weeks") showYear(viewYear.value - 1);
  else pageStart.value = Math.max(MIN_PICKER_YEAR, pageStart.value - years.value.length);
}
function stepForward(): void {
  if (view.value === "weeks") showYear(viewYear.value + 1);
  else pageStart.value += years.value.length;
}

async function toggleYears(): Promise<void> {
  if (view.value === "weeks") {
    view.value = "years";
    focusedYear.value = viewYear.value;
    pageStart.value = yearPageStart(viewYear.value);
  } else {
    view.value = "weeks";
  }
  await focusGrid();
}

async function chooseYear(year: number): Promise<void> {
  showYear(year);
  view.value = "weeks";
  await focusGrid();
}

/** Focus the roving cell of the visible grid. */
async function focusGrid(): Promise<void> {
  await nextTick();
  gridRef.value?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
}

// ------------------------------------------------------------------ keyboard
function onWeekKeydown(event: KeyboardEvent): void {
  // The cell the key was pressed on is the focused one (also when focus events were deferred).
  const fromTarget = Number((event.target as HTMLElement | null)?.dataset?.week);
  if (fromTarget) focusedWeek.value = fromTarget;
  gridHasFocus.value = true;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectWeek(focusedWeek.value);
    return;
  }
  const next = moveWeekFocus({ isoYear: viewYear.value, week: focusedWeek.value }, event.key, columns.value);
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  viewYear.value = next.isoYear;
  focusedWeek.value = next.week;
  hoveredWeek.value = null;
  void focusGrid();
}

function onYearKeydown(event: KeyboardEvent): void {
  const fromTarget = Number((event.target as HTMLElement | null)?.dataset?.year);
  if (fromTarget) focusedYear.value = fromTarget;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    void chooseYear(focusedYear.value);
    return;
  }
  const next = moveYearFocus(focusedYear.value, pageStart.value, event.key);
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  focusedYear.value = next.year;
  pageStart.value = next.pageStart;
  void focusGrid();
}

function onGridFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null;
  if (!next || !gridRef.value?.contains(next)) gridHasFocus.value = false;
}

defineExpose({ focusGrid });
</script>

<template>
  <div class="wp" :class="{ 'wp--compact': compact }" :style="{ '--_cols': String(columns) }">
    <div class="wp__header">
      <UiIconButton
        :label="view === 'weeks' ? 'Previous year' : 'Previous years'"
        size="sm"
        :disabled="!canGoBack"
        @click="stepBack"
      >
        <ChevronLeft :size="16" />
      </UiIconButton>
      <button
        type="button"
        class="wp__year"
        :aria-expanded="view === 'years'"
        :aria-label="yearButtonLabel"
        @click="toggleYears"
      >
        <span class="tabular">{{ view === "weeks" ? viewYear : `${years[0]} – ${years[years.length - 1]}` }}</span>
        <ChevronDown :size="14" class="wp__year-chevron" :class="{ 'is-open': view === 'years' }" />
      </button>
      <UiIconButton :label="view === 'weeks' ? 'Next year' : 'Next years'" size="sm" @click="stepForward">
        <ChevronRight :size="16" />
      </UiIconButton>
    </div>

    <!-- Weeks of the ISO week-year -->
    <div
      v-if="view === 'weeks'"
      ref="gridRef"
      class="wp__grid"
      role="grid"
      :aria-label="`Weeks of ${viewYear}`"
      @keydown="onWeekKeydown"
      @focusin="gridHasFocus = true"
      @focusout="onGridFocusOut"
      @pointerleave="hoveredWeek = null"
    >
      <div v-for="(row, r) in rows" :key="r" class="wp__row" role="row">
        <div
          v-for="cell in row"
          :key="cell.week"
          :data-week="cell.week"
          role="gridcell"
          class="wp__cell tabular"
          :class="{ 'is-selected': isSelected(cell.week), 'is-current': isThisWeek(cell.week) }"
          :tabindex="cell.week === focusedWeek ? 0 : -1"
          :aria-selected="isSelected(cell.week)"
          :aria-current="isThisWeek(cell.week) ? 'date' : undefined"
          :aria-label="cellLabel(cell)"
          :title="cell.label"
          :data-autofocus="autofocus && cell.week === focusedWeek ? '' : undefined"
          @click="selectWeek(cell.week)"
          @pointerenter="hoveredWeek = cell.week"
          @focus="focusedWeek = cell.week"
        >
          {{ cell.week }}
        </div>
      </div>
    </div>

    <!-- Years -->
    <div
      v-else
      ref="gridRef"
      class="wp__grid wp__grid--years"
      role="grid"
      aria-label="Years"
      @keydown="onYearKeydown"
    >
      <div v-for="(row, r) in yearRows" :key="r" class="wp__row wp__row--years" role="row">
        <div
          v-for="year in row"
          :key="year"
          :data-year="year"
          role="gridcell"
          class="wp__cell wp__cell--year tabular"
          :class="{ 'is-selected': year === selected.isoYear, 'is-current': year === thisWeek.isoYear }"
          :tabindex="year === focusedYear ? 0 : -1"
          :aria-selected="year === selected.isoYear"
          :aria-current="year === thisWeek.isoYear ? 'date' : undefined"
          :data-autofocus="autofocus && year === focusedYear ? '' : undefined"
          @click="chooseYear(year)"
          @focus="focusedYear = year"
        >
          {{ year }}
        </div>
      </div>
    </div>

    <p class="wp__caption tabular" aria-hidden="true">
      {{ view === "weeks" ? caption : "Choose a year" }}
    </p>
  </div>
</template>

<style scoped>
.wp {
  --_cell: 34px;
  width: 100%;
  min-width: 252px;
  user-select: none;
  -webkit-user-select: none;
}
.wp--compact {
  --_cell: 32px;
  min-width: 0;
}
@media (pointer: coarse) {
  .wp,
  .wp--compact {
    --_cell: 40px;
  }
}

.wp__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1);
  margin-bottom: var(--space-1-5);
}
.wp__year {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: var(--control-h-sm);
  padding: 0 var(--space-2-5);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-semibold);
  transition: background-color var(--dur-fast) var(--ease-standard);
}
.wp__year:hover,
.wp__year[aria-expanded="true"] {
  background-color: var(--bg-subtle);
}
.wp__year-chevron {
  color: var(--text-tertiary);
  transition: transform var(--dur-fast) var(--ease-standard);
}
.wp__year-chevron.is-open {
  transform: rotate(180deg);
}

.wp__grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wp__row {
  display: grid;
  grid-template-columns: repeat(var(--_cols), minmax(0, 1fr));
  gap: 2px;
}
/* Sidebar: 7 × 32px fill the 224px column exactly. */
.wp--compact .wp__row {
  gap: 0;
}
.wp__row--years {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.wp__cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--_cell);
  min-width: 0;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  cursor: pointer;
  outline: none;
  transition: background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.wp__cell--year {
  height: calc(var(--_cell) + 4px);
}
.wp__cell:hover {
  background-color: var(--bg-subtle);
  color: var(--text-primary);
}
.wp__cell:focus-visible {
  box-shadow: inset 0 0 0 2px var(--focus-ring);
}

/* This week: accent text + a small dot (color is not the only signal; aria-current too). */
.wp__cell.is-current {
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}
.wp__cell.is-current::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: 4px;
  width: 4px;
  height: 4px;
  margin-left: -2px;
  border-radius: var(--radius-full);
  background-color: currentColor;
}

/* Selected week: accent fill. */
.wp__cell.is-selected {
  background-color: var(--accent);
  color: var(--text-on-accent);
  font-weight: var(--fw-semibold);
}
.wp__cell.is-selected:hover {
  background-color: var(--accent-hover);
}
.wp__cell.is-selected:focus-visible {
  box-shadow: inset 0 0 0 2px var(--bg-raised), 0 0 0 2px var(--focus-ring);
}

.wp__caption {
  min-height: var(--lh-12);
  margin-top: var(--space-2);
  padding: 0 var(--space-1);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
  text-align: center;
}

@media (forced-colors: active) {
  .wp__cell.is-selected {
    outline: 2px solid Highlight;
  }
  .wp__cell:focus-visible {
    outline: 2px solid Highlight;
  }
}
</style>
