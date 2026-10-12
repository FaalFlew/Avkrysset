<script setup lang="ts">
/**
 * ChartDataTable — the accessible "View data" twin of a chart: a collapsible table with the
 * exact values the chart draws (tooltips never gate information).
 * Props:
 *   caption: string — table caption (sr-only; the summary text is visible)
 *   columns: { key, label, align? ('start' | 'end') }[] — the first column is the row header
 *   rows: { id, cells: Record<columnKey, string> }[]
 *   footer?: Record<columnKey, string> — optional totals row
 *   summaryLabel?: string (default "View data")
 *   loading?: boolean — render a same-height placeholder (no layout jump when data arrives)
 */
import { ChevronRight } from "lucide-vue-next";
import { UiSkeleton } from "@/components/ui";
import type { DataTableColumn, DataTableRow } from "./types";

withDefaults(
  defineProps<{
    caption: string;
    columns: DataTableColumn[];
    rows: DataTableRow[];
    footer?: Record<string, string>;
    summaryLabel?: string;
    loading?: boolean;
  }>(),
  { footer: undefined, summaryLabel: "View data", loading: false }
);
</script>

<template>
  <div v-if="loading" class="data-table data-table--skeleton" aria-hidden="true">
    <UiSkeleton :width="76" :height="10" />
  </div>
  <details v-else class="data-table">
    <summary class="data-table__summary">
      <ChevronRight :size="14" class="data-table__chevron" aria-hidden="true" />
      {{ summaryLabel }}
    </summary>
    <div class="data-table__scroll">
      <table>
        <caption class="sr-only">{{ caption }}</caption>
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              :class="{ 'is-end': column.align === 'end' }"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <template v-for="(column, index) in columns" :key="column.key">
              <th v-if="index === 0" scope="row">{{ row.cells[column.key] }}</th>
              <td v-else :class="{ 'is-end': column.align === 'end' }">
                {{ row.cells[column.key] }}
              </td>
            </template>
          </tr>
        </tbody>
        <tfoot v-if="footer">
          <tr>
            <template v-for="(column, index) in columns" :key="column.key">
              <th v-if="index === 0" scope="row">{{ footer[column.key] }}</th>
              <td v-else :class="{ 'is-end': column.align === 'end' }">
                {{ footer[column.key] }}
              </td>
            </template>
          </tr>
        </tfoot>
      </table>
    </div>
  </details>
</template>

<style scoped>
.data-table {
  margin-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  padding-top: var(--space-2);
}

.data-table--skeleton {
  display: flex;
  align-items: center;
  height: calc(var(--control-h-sm) + var(--space-2) + 1px);
}

.data-table__summary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--control-h-sm);
  padding: 0 var(--space-2) 0 var(--space-1);
  margin-left: calc(-1 * var(--space-1));
  border-radius: var(--radius-md);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
  cursor: pointer;
  list-style: none;
  user-select: none;
  transition: background-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}
.data-table__summary::-webkit-details-marker {
  display: none;
}
.data-table__summary:hover {
  background-color: var(--bg-subtle);
  color: var(--text-primary);
}
.data-table__chevron {
  transition: transform var(--dur-fast) var(--ease-standard);
}
.data-table[open] .data-table__chevron {
  transform: rotate(90deg);
}

.data-table__scroll {
  margin-top: var(--space-2);
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-13);
  line-height: var(--lh-13);
}

th,
td {
  padding: var(--space-1-5) var(--space-3);
  text-align: start;
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
}

thead th {
  position: sticky;
  top: 0;
  background-color: var(--bg-inset);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  font-weight: var(--fw-medium);
  color: var(--text-tertiary);
}

tbody th {
  min-width: 9em;
  white-space: normal;
  font-weight: var(--fw-regular);
  color: var(--text-primary);
}

td {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.is-end {
  text-align: end;
}

tbody tr:last-child th,
tbody tr:last-child td {
  border-bottom: none;
}

tfoot th,
tfoot td {
  border-top: 1px solid var(--border-default);
  border-bottom: none;
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
</style>
