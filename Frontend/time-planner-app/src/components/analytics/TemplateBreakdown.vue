<script setup lang="ts">
/**
 * TemplateBreakdown — "Time by template": hours and share per template, plus a muted
 * "Without template" row, as a table (card rows when the card is narrow).
 * Props:
 *   templates: TemplateRow[] — largest first
 *   untemplatedHours: number
 *   totalHours: number
 *   scopeLabel: string
 *   loading?: boolean — skeleton rows
 *   refetching?: boolean — spinner in the header
 */
import { computed } from "vue";
import { LayoutTemplate } from "lucide-vue-next";
import { UiButton, UiCard, UiEmptyState, UiSkeleton, UiSpinner } from "@/components/ui";
import { formatHours, formatPercent } from "@/lib/format";
import type { TemplateRow } from "@/composables/useStats";

const props = withDefaults(
  defineProps<{
    templates: TemplateRow[];
    untemplatedHours: number;
    totalHours: number;
    scopeLabel: string;
    loading?: boolean;
    refetching?: boolean;
  }>(),
  { loading: false, refetching: false }
);

/** Don't show a "Without template" row for rounding noise. */
const MIN_UNTEMPLATED_HOURS = 0.05;

interface Row {
  id: string;
  name: string;
  color: string | null;
  hours: number;
  share: number;
  muted: boolean;
  deleted: boolean;
}

const rows = computed<Row[]>(() => {
  const list: Row[] = props.templates
    .filter((t) => t.hours > 0)
    .map((t) => ({ ...t, muted: false }));
  if (props.untemplatedHours > MIN_UNTEMPLATED_HOURS) {
    list.push({
      id: "__without-template",
      name: "Without template",
      color: null,
      hours: props.untemplatedHours,
      share: props.totalHours > 0 ? props.untemplatedHours / props.totalHours : 0,
      muted: true,
      deleted: false,
    });
  }
  return list;
});

const hasTemplates = computed(() => props.templates.some((t) => t.hours > 0));

const meterWidth = (share: number) => `${Math.max(0, Math.min(1, share)) * 100}%`;
</script>

<template>
  <UiCard title="Time by template" class="template-card">
    <template #actions>
      <UiSpinner v-if="refetching" :size="14" />
    </template>

    <div v-if="loading" class="skeleton-rows" aria-hidden="true">
      <div class="skeleton-head"><UiSkeleton :width="72" :height="10" /></div>
      <div v-for="i in 4" :key="i" class="skeleton-row">
        <UiSkeleton :width="`${40 - i * 6}%`" :height="14" />
        <UiSkeleton :width="48" :height="14" />
        <UiSkeleton :width="120" :height="6" radius="9999px" />
      </div>
    </div>

    <UiEmptyState
      v-else-if="!hasTemplates"
      size="sm"
      :heading-level="3"
      :icon="LayoutTemplate"
      title="No template-based tasks in this period."
      :description="
        totalHours > 0
          ? `All ${formatHours(totalHours)} were planned without a template.`
          : undefined
      "
    >
      <template #actions>
        <UiButton variant="ghost" size="sm" to="/templates">Manage templates</UiButton>
      </template>
    </UiEmptyState>

    <table v-else class="template-table">
      <caption class="sr-only">Time by template, {{ scopeLabel }}</caption>
      <thead>
        <tr>
          <th scope="col">Template</th>
          <th scope="col" class="is-end col-hours">Hours</th>
          <th scope="col" class="col-share">Share</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{ 'is-muted': row.muted }">
          <th scope="row" class="cell-name">
            <span class="name-wrap">
              <span
                class="dot"
                :class="{ 'dot--empty': row.muted }"
                :style="row.muted ? undefined : { backgroundColor: row.color || 'var(--chart-neutral)' }"
                aria-hidden="true"
              ></span>
              <span class="name" :class="{ 'name--deleted': row.deleted }" :title="row.name">
                {{ row.name }}
              </span>
            </span>
          </th>
          <td class="is-end cell-hours">{{ formatHours(row.hours) }}</td>
          <td class="col-share">
            <span class="share">
              <span class="meter" aria-hidden="true">
                <span
                  class="meter__fill"
                  :style="{
                    width: meterWidth(row.share),
                    backgroundColor: row.muted ? 'var(--chart-neutral)' : row.color || 'var(--chart-neutral)',
                  }"
                ></span>
              </span>
              <span class="share__pct">{{ formatPercent(row.share) }}</span>
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </UiCard>
</template>

<style scoped>
.template-card {
  min-width: 0;
  container-type: inline-size;
}

.template-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: var(--fs-14);
  line-height: var(--lh-14);
}

thead th {
  padding: var(--space-2) var(--space-3);
  background-color: var(--bg-inset);
  border-bottom: 1px solid var(--border-subtle);
  text-align: start;
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  font-weight: var(--fw-medium);
  color: var(--text-tertiary);
}
thead th:first-child {
  border-top-left-radius: var(--radius-md);
}
thead th:last-child {
  border-top-right-radius: var(--radius-md);
}

tbody th,
tbody td {
  height: 44px;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  text-align: start;
  font-weight: var(--fw-regular);
}
tbody tr:last-child th,
tbody tr:last-child td {
  border-bottom: none;
}
tbody tr {
  transition: background-color var(--dur-fast) var(--ease-standard);
}
tbody tr:hover {
  background-color: var(--bg-subtle);
}

.is-end {
  text-align: end !important;
}

.cell-name {
  color: var(--text-primary);
}

.name-wrap {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.col-hours {
  width: 96px;
}

.dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}
.dot--empty {
  border: 1.5px solid var(--text-tertiary);
}

.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name--deleted {
  font-style: italic;
  color: var(--text-secondary);
}

.is-muted .name,
.is-muted .cell-hours {
  color: var(--text-secondary);
}

.cell-hours {
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  white-space: nowrap;
}

.col-share {
  width: 200px;
  white-space: nowrap;
}

.share {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.meter {
  position: relative;
  width: clamp(80px, 12cqi, 120px);
  height: 6px;
  border-radius: var(--radius-full);
  background-color: var(--bg-muted);
  overflow: hidden;
}

.meter__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: var(--radius-full);
  transition: width var(--dur-base) var(--ease-standard);
}

.share__pct {
  min-width: 3.5em;
  text-align: end;
  font-size: var(--fs-13);
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
}

.skeleton-rows {
  display: flex;
  flex-direction: column;
}
.skeleton-head {
  display: flex;
  align-items: center;
  height: 33px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  background-color: var(--bg-inset);
}
.skeleton-row {
  padding: 0 var(--space-3);
}
.skeleton-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: var(--space-4);
  height: 44px;
  border-bottom: 1px solid var(--border-subtle);
}

@media print {
  tbody th,
  tbody td {
    height: 32px;
  }
  tbody tr {
    break-inside: avoid;
  }
  thead {
    display: table-header-group;
  }
}

/* Narrow card: each row becomes name + hours on top, meter + share underneath. */
@container (max-width: 639.98px) {
  .template-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .template-table,
  .template-table tbody {
    display: block;
  }
  .template-table tbody tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "name hours"
      "share share";
    row-gap: var(--space-1-5);
    padding: var(--space-2-5) 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .template-table tbody tr:last-child {
    border-bottom: none;
  }
  .template-table tbody th,
  .template-table tbody td {
    display: flex;
    height: auto;
    padding: 0;
    border-bottom: none;
  }
  .cell-name {
    grid-area: name;
    min-width: 0;
  }
  .name-wrap {
    width: 100%;
  }
  .cell-hours {
    grid-area: hours;
  }
  .col-share {
    grid-area: share;
    width: auto;
  }
  .share {
    width: 100%;
  }
  .meter {
    flex: 1 1 auto;
    width: auto;
  }
  .skeleton-row {
    grid-template-columns: 1fr auto;
  }
  .skeleton-row > :last-child {
    display: none;
  }
}
</style>
