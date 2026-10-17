<script setup lang="ts">
/**
 * TaskListTable — the rows of the analytics task list: one <tbody> per day (a row-group header
 * with the day's subtotal), a task row per task and the grand total in <tfoot>.
 * Wide cards (≥ 760px of card width, and always on paper): a table with a sticky column header
 * (repeated on every printed page). Narrow cards (phones, small tablets): every row becomes a card
 * (title + duration, time, then category · template · organization · creator).
 * A row opens its task: the title is a button (Enter/Space), and a click anywhere on the row
 * does the same (unless the user is selecting text).
 * Props:
 *   days: TaskListPageDay[] — the day groups on the current page (subtotals cover the whole day)
 *   caption: string — accessible table caption
 *   showOrganization: boolean — Organization column (when any task of the range has one)
 *   totals: { count, hours } — of the rows matching the filters
 *   allCount: number — tasks in the range (shown next to the count when filtered)
 *   filtered: boolean
 * Emits: open(row)
 */
import { computed } from "vue";
import { formatDate, formatTimeRange } from "@/lib/datetime";
import { formatDuration, pluralize } from "@/lib/format";
import { taskEndDayOffset } from "@/lib/plannerFormat";
import type { TaskListPageDay, TaskListRow, TaskListTotals } from "@/lib/taskList";

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

/** "+1d" and how a screen reader says it ("ends the next day"). */
function endMarker(row: TaskListRow): { text: string; spoken: string } | null {
  const days = taskEndDayOffset(row.start, row.hours);
  if (days <= 0) return null;
  return { text: `+${days}d`, spoken: days === 1 ? "ends the next day" : `ends ${days} days later` };
}

const dayHeaderId = (day: TaskListPageDay) => `task-day-${day.dateKey}`;

function daySummary(day: TaskListPageDay): string {
  return `${pluralize(day.count, "task")} · ${formatDuration(day.hours)}`;
}

const countText = computed(() =>
  props.filtered
    ? `${props.totals.count} of ${pluralize(props.allCount, "task")}`
    : pluralize(props.totals.count, "task")
);

function onRowClick(event: MouseEvent, row: TaskListRow): void {
  // Selecting a title to copy it is not a click on the row.
  const selection = typeof window !== "undefined" ? window.getSelection?.()?.toString() : "";
  const onButton = (event.target as HTMLElement | null)?.closest?.("button");
  if (selection && !onButton) return;
  emit("open", row);
}
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
        <th :id="dayHeaderId(day)" :colspan="columnCount" scope="rowgroup" class="day-row__cell">
          <span class="day-row__inner">
            <span class="day-row__date">{{ formatDate(day.dateKey, "full") }}</span>
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
          <button type="button" class="title-button" aria-haspopup="dialog">{{ row.label }}</button>
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
          <span class="card-label">Template: </span>{{ row.templateTitle ?? "—" }}
        </td>
        <td v-if="showOrganization" class="col-org cell-org" :class="{ 'is-empty': !row.organizationName }">
          {{ row.organizationName ?? "—" }}
        </td>
        <td class="col-created cell-created">
          <span class="card-label">Created by </span>{{ row.createdBy }}
        </td>
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

/* Labels only cards show (the column header names them in the table). */
.card-label {
  display: none;
}

/* ---------- Grand total ---------- */
.total-row > * {
  padding-top: var(--space-2-5);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---------- Narrow card: rows become cards (screens only; paper always gets the table) ---------- */
@media screen {
  @container tasklist (max-width: 759.98px) {
    .task-table,
    .task-table tbody,
    .task-table tfoot {
      display: block;
    }
    .task-table thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .day-row,
    .day-row__cell {
      display: block;
    }
    .day-row__cell {
      padding: var(--space-4) 0 var(--space-1-5);
    }
    .day:first-of-type .day-row__cell {
      padding-top: var(--space-1);
    }

    .task-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: var(--space-2);
      row-gap: var(--space-1);
      padding: var(--space-2-5) var(--space-2);
      margin: 0 calc(-1 * var(--space-2));
      border-bottom: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
    }
    .task-row > * {
      display: block;
      padding: 0;
      border-bottom: none;
    }
    .day:last-of-type .task-row:last-child {
      border-bottom-color: var(--border-default);
    }
    .cell-title {
      order: 1;
      flex: 1 1 0;
      min-width: 0;
    }
    .cell-duration {
      order: 2;
      flex: none;
      font-weight: var(--fw-medium);
      color: var(--text-primary);
    }
    .cell-time {
      order: 3;
      flex: 0 0 100%;
    }
    .cell-category,
    .cell-template,
    .cell-org,
    .cell-created {
      order: 4;
      flex: 0 1 auto;
      min-width: 0;
      font-size: var(--fs-12);
      line-height: var(--lh-12);
    }
    .cell-category ~ :not(.is-empty)::before {
      content: "·";
      margin-inline-end: var(--space-2);
      color: var(--text-tertiary);
    }
    .cell-template.is-empty,
    .cell-org.is-empty {
      display: none;
    }
    .card-label {
      display: inline;
    }
    .title-button {
      font-size: var(--fs-14);
      line-height: var(--lh-14);
    }

    .total-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: var(--space-2);
      padding: var(--space-3) 0 0;
    }
    .total-row > * {
      display: block;
      padding: 0;
    }
    .total-row__count {
      order: -1;
      flex: 1 1 auto;
      font-weight: var(--fw-regular);
      color: var(--text-secondary);
    }
    .total-row > th {
      display: none;
    }
  }
}

/* Touch: the title button is the row's control; the whole card row is the tap target. */
@media (pointer: coarse) {
  .task-row {
    min-height: 44px;
  }
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
  .end-marker {
    font-size: var(--fs-11);
  }
}
</style>
