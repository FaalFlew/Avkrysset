<script setup lang="ts">
/**
 * TaskListTable — the analytics task list as a table (wide cards, and always on paper): one
 * <tbody> per day (a row-group header with the day's subtotal), a task row per task and the
 * grand total in <tfoot>. The column header is sticky on screen and repeats on every printed
 * page. Narrow cards render TaskListCards instead (semantic list markup).
 * A row opens its task: the title is a button (Enter/Space), and a click anywhere on the row does
 * the same (unless the user is selecting text).
 * Props:
 *   days: TaskListPageDay[] — the day groups on the current page (subtotals cover the whole day)
 *   caption: string — accessible table caption
 *   showOrganization: boolean — Organization column (when any task of the range has one)
 *   totals: { count, hours } — of the rows matching the filters
 *   allCount: number — tasks in the range (shown next to the count when filtered)
 *   filtered: boolean
 * Emits: open(row)
 * Exposes: focusRow(id) — move focus to a row's title button
 */
import { computed } from "vue";
import { formatDate, formatTimeRange } from "@/lib/datetime";
import { formatDuration } from "@/lib/format";
import type { TaskListPageDay, TaskListRow, TaskListTotals } from "@/lib/taskList";
import { daySummary, endMarker, isRowActivation, totalCountText } from "./taskListView";

const props = defineProps<{
  days: TaskListPageDay[];
  caption: string;
  showOrganization: boolean;
  totals: TaskListTotals;
  allCount: number;
  filtered: boolean;
}>();

const emit = defineEmits<{ open: [row: TaskListRow] }>();

const columnCount = computed(() => (props.showOrganization ? 7 : 6));
const countText = computed(() => totalCountText(props.totals.count, props.allCount, props.filtered));

const buttons = new Map<string, { focus: () => void }>();
function setButton(id: string, el: unknown): void {
  if (el) buttons.set(id, el as { focus: () => void });
  else buttons.delete(id);
}

function onRowClick(event: MouseEvent, row: TaskListRow): void {
  if (isRowActivation(event)) emit("open", row);
}

defineExpose({
  focusRow: (id: string) => {
    const button = buttons.get(id);
    button?.focus();
    return !!button;
  },
});
</script>

<template>
  <table class="task-table" :class="{ 'has-org': showOrganization }">
    <caption class="sr-only">{{ caption }}</caption>
    <thead>
      <tr>
        <th scope="col" class="col-time">Time</th>
        <th scope="col" class="col-duration is-end">Duration</th>
        <th scope="col" class="col-title">Title</th>
        <th scope="col" class="col-category">Category</th>
        <th scope="col" class="col-template">Template</th>
        <th v-if="showOrganization" scope="col" class="col-org">Organization</th>
        <th scope="col" class="col-created">Created by</th>
      </tr>
    </thead>

    <tbody v-for="day in days" :key="day.dateKey" class="day">
      <tr class="day-row">
        <th :colspan="columnCount" scope="rowgroup" class="day-row__cell">
          <span class="day-row__inner">
            <span class="day-row__date">{{ formatDate(day.dateKey, "full") }}</span>
            <span class="sr-only">, </span>
            <span class="day-row__total">{{ daySummary(day) }}</span>
          </span>
        </th>
      </tr>
      <tr
        v-for="row in day.visibleRows"
        :key="row.id"
        class="task-row"
        :data-task-id="row.id"
        @click="onRowClick($event, row)"
      >
        <td class="col-time cell-time">
          <span>{{ formatTimeRange(row.start, row.hours) }}</span>
          <template v-if="endMarker(row)">
            <span class="end-marker" aria-hidden="true">{{ endMarker(row)!.text }}</span>
            <span class="sr-only">, {{ endMarker(row)!.spoken }}</span>
          </template>
        </td>
        <td class="col-duration cell-duration is-end">{{ formatDuration(row.hours) }}</td>
        <th scope="row" class="col-title cell-title">
          <button
            :ref="(el) => setButton(row.id, el)"
            type="button"
            class="title-button"
            aria-haspopup="dialog"
          >
            {{ row.label }}
          </button>
        </th>
        <td class="col-category cell-category">
          <span class="category">
            <span
              class="swatch"
              :style="{ backgroundColor: row.category.color || 'var(--chart-neutral)' }"
              aria-hidden="true"
            ></span>
            <span class="category__name">{{ row.category.name }}</span>
          </span>
        </td>
        <td
          class="col-template cell-template"
          :class="{ 'is-empty': !row.templateTitle, 'is-deleted': row.templateDeleted }"
        >
          {{ row.templateTitle ?? "—" }}
        </td>
        <td v-if="showOrganization" class="col-org cell-org" :class="{ 'is-empty': !row.organizationName }">
          {{ row.organizationName ?? "—" }}
        </td>
        <td class="col-created cell-created">{{ row.createdBy }}</td>
      </tr>
    </tbody>

    <tfoot>
      <tr class="total-row">
        <th scope="row" class="col-time">{{ filtered ? "Total (filtered)" : "Total" }}</th>
        <td class="col-duration is-end">{{ formatDuration(totals.hours) }}</td>
        <td :colspan="columnCount - 2" class="total-row__count">{{ countText }}</td>
      </tr>
    </tfoot>
  </table>
</template>

<style scoped>
.task-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--fs-13);
  line-height: var(--lh-13);
}

th,
td {
  padding: var(--space-2) var(--space-3);
  text-align: start;
  vertical-align: top;
  font-weight: var(--fw-regular);
}

.is-end {
  text-align: end !important;
}

/* ---------- Column header (sticky inside the page's scroll area) ---------- */
thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding-top: var(--space-2);
  padding-bottom: var(--space-2);
  background-color: var(--bg-surface);
  box-shadow: inset 0 -1px 0 var(--border-default);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  font-weight: var(--fw-medium);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.col-time {
  width: 1%;
  white-space: nowrap;
}
.col-duration {
  width: 1%;
  white-space: nowrap;
}
.col-category {
  width: 18%;
}
.col-template {
  width: 16%;
}
.col-org {
  width: 14%;
}
.col-created {
  width: 14%;
}

/* ---------- Day header ---------- */
.day-row__cell {
  padding: var(--space-4) var(--space-3) var(--space-1-5);
  border-bottom: 1px solid var(--border-subtle);
}
.day:first-of-type .day-row__cell {
  padding-top: var(--space-3);
}
.day-row__inner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-4);
}
.day-row__date {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.day-row__total {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* ---------- Task rows ---------- */
.task-row {
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-standard);
}
.task-row > * {
  border-bottom: 1px solid var(--border-subtle);
}
.day:last-of-type .task-row:last-child > * {
  border-bottom-color: var(--border-default);
}
.task-row:hover,
.task-row:focus-within {
  background-color: var(--bg-subtle);
}

.cell-time,
.cell-duration {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.end-marker {
  display: inline-block;
  margin-inline-start: var(--space-1);
  padding: 0 var(--space-1);
  border-radius: var(--radius-xs);
  background-color: var(--bg-muted);
  font-size: var(--fs-11);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
}

.cell-title {
  min-width: 10em;
}

.title-button {
  display: inline;
  padding: 0;
  margin: 0;
  border: 0;
  background: none;
  font: inherit;
  font-weight: var(--fw-medium);
  color: var(--text-primary);
  text-align: start;
  overflow-wrap: anywhere;
  cursor: pointer;
  border-radius: var(--radius-xs);
}
.title-button:hover {
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
  text-underline-offset: 2px;
}

.category {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1-5);
  min-width: 0;
  max-width: 100%;
}
.swatch {
  flex-shrink: 0;
  align-self: center;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}
.category__name {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
}

.cell-template,
.cell-org,
.cell-created {
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.cell-template.is-empty,
.cell-org.is-empty {
  color: var(--text-tertiary);
}
.cell-template.is-deleted {
  font-style: italic;
}

/* ---------- Grand total ---------- */
.total-row > * {
  padding-top: var(--space-2-5);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---------- Paper ---------- */
@media print {
  .task-table {
    font-size: var(--fs-12);
    line-height: var(--lh-12);
  }
  thead th {
    position: static;
    background-color: transparent;
  }
  thead {
    display: table-header-group;
  }
  th,
  td {
    padding: var(--space-1) var(--space-2);
  }
  .task-row,
  .day-row {
    break-inside: avoid;
  }
  /* A day header stays with its first task. */
  .day-row {
    break-after: avoid;
  }
  .task-row:hover,
  .task-row:focus-within {
    background: none;
  }
}
</style>
