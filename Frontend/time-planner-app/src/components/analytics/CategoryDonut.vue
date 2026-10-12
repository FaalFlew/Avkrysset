<script setup lang="ts">
/**
 * CategoryDonut — "Time by category": a donut of at most 6 segments (top 5 + "n more"),
 * the total in the center, and a ranked legend listing every category with hours and share.
 * Props:
 *   categories: CategorySlice[] — largest first
 *   totalHours: number
 *   scopeLabel: string — range label for the caption
 *   loading?: boolean — skeleton body
 *   refetching?: boolean — spinner in the header
 * Colors follow the category (never its rank); the "n more" segment uses the neutral token.
 */
import { computed, ref } from "vue";
import { Doughnut } from "vue-chartjs";
import type { ChartData, ChartOptions, TooltipItem } from "chart.js";
import { UiCard, UiSkeleton, UiSpinner } from "@/components/ui";
import { formatHours, formatPercent, pluralize } from "@/lib/format";
import type { CategorySlice } from "@/composables/useStats";
import ChartDataTable from "./ChartDataTable.vue";
import type { DataTableRow } from "./types";
import { clipName } from "./format";
import { setupCharts } from "./chartSetup";
import { tooltipStyle, useChartTheme } from "./useChartTheme";

setupCharts();

const props = withDefaults(
  defineProps<{
    categories: CategorySlice[];
    totalHours: number;
    scopeLabel: string;
    loading?: boolean;
    refetching?: boolean;
  }>(),
  { loading: false, refetching: false }
);

const MAX_SEGMENTS = 6;
const LEGEND_PREVIEW = 6;

const theme = useChartTheme();
const showAll = ref(false);

interface Segment {
  name: string;
  hours: number;
  share: number;
  color: string;
}

const segments = computed<Segment[]>(() => {
  const list = props.categories.filter((c) => c.hours > 0);
  const neutral = theme.value.neutral;
  const toSegment = (c: CategorySlice): Segment => ({
    name: c.name,
    hours: c.hours,
    share: c.share,
    color: c.color || neutral,
  });
  if (list.length <= MAX_SEGMENTS) return list.map(toSegment);
  const head = list.slice(0, MAX_SEGMENTS - 1).map(toSegment);
  const tail = list.slice(MAX_SEGMENTS - 1);
  const hours = tail.reduce((sum, c) => sum + c.hours, 0);
  return [
    ...head,
    {
      name: `${tail.length} more`,
      hours,
      share: props.totalHours > 0 ? hours / props.totalHours : 0,
      color: neutral,
    },
  ];
});

const legend = computed(() =>
  showAll.value ? props.categories : props.categories.slice(0, LEGEND_PREVIEW)
);
const hiddenCount = computed(() => Math.max(0, props.categories.length - LEGEND_PREVIEW));

const summary = computed(() => {
  const top = props.categories[0];
  if (!top) return `Time by category, ${props.scopeLabel}. No time planned.`;
  return (
    `Time by category, ${props.scopeLabel}. ` +
    `${pluralize(props.categories.length, "category", "categories")}, ${formatHours(props.totalHours)} in total. ` +
    `Largest: ${top.name}, ${formatHours(top.hours)} (${formatPercent(top.share)}).`
  );
});

const chartData = computed<ChartData<"doughnut">>(() => ({
  labels: segments.value.map((s) => s.name),
  datasets: [
    {
      label: "Hours by category",
      data: segments.value.map((s) => s.hours),
      backgroundColor: segments.value.map((s) => s.color),
      hoverBackgroundColor: segments.value.map((s) => s.color),
      borderColor: theme.value.sliceGap,
      hoverBorderColor: theme.value.sliceGap,
      borderWidth: 2,
      hoverOffset: 4,
    },
  ],
}));

const chartOptions = computed<ChartOptions<"doughnut">>(() => {
  const t = theme.value;
  const list = segments.value;
  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "68%",
    layout: { padding: 4 },
    animation: { duration: t.animationMs, easing: "easeOutCubic" },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipStyle(t),
        callbacks: {
          title: () => "",
          label: (item: TooltipItem<"doughnut">) => {
            const s = list[item.dataIndex];
            return s ? `${clipName(s.name, 32)} · ${formatHours(s.hours)} (${formatPercent(s.share)})` : "";
          },
        },
      },
    },
  };
});

const tableRows = computed<DataTableRow[]>(() =>
  props.categories.map((c) => ({
    id: c.id,
    cells: { name: c.name, hours: formatHours(c.hours), share: formatPercent(c.share) },
  }))
);

const tableColumns = [
  { key: "name", label: "Category" },
  { key: "hours", label: "Hours", align: "end" as const },
  { key: "share", label: "Share", align: "end" as const },
];
</script>

<template>
  <UiCard title="Time by category" class="donut-card">
    <template #actions>
      <UiSpinner v-if="refetching" :size="14" />
    </template>

    <div v-if="loading" class="donut-layout" aria-hidden="true">
      <div class="donut-box">
        <UiSkeleton :width="180" :height="180" radius="9999px" />
      </div>
      <div class="legend legend--skeleton">
        <span v-for="i in 4" :key="i" class="legend__skeleton-row">
          <UiSkeleton :height="10" :width="`${90 - i * 10}%`" />
        </span>
      </div>
    </div>

    <div v-else class="donut-layout">
      <figure class="donut-figure">
        <figcaption class="sr-only">{{ summary }}</figcaption>
        <div class="donut-box">
          <Doughnut :data="chartData" :options="chartOptions" :aria-label="summary" />
          <div class="donut-center" aria-hidden="true">
            <span class="donut-center__value">{{ formatHours(totalHours) }}</span>
            <span class="donut-center__label">total</span>
          </div>
        </div>
      </figure>

      <div class="legend">
        <ol class="legend__list" role="list" aria-label="Categories by time">
          <li v-for="c in legend" :key="c.id" class="legend__item">
            <span
              class="legend__dot"
              :style="{ backgroundColor: c.color || 'var(--chart-neutral)' }"
              aria-hidden="true"
            ></span>
            <span class="legend__name" :title="c.name">{{ c.name }}</span>
            <span class="legend__hours">{{ formatHours(c.hours) }}</span>
            <span class="legend__share">{{ formatPercent(c.share) }}</span>
          </li>
        </ol>
        <button
          v-if="hiddenCount > 0"
          type="button"
          class="legend__toggle"
          :aria-expanded="showAll"
          @click="showAll = !showAll"
        >
          {{ showAll ? "Show fewer" : `Show all (${categories.length})` }}
        </button>
      </div>
    </div>

    <ChartDataTable
      :loading="loading"
      :caption="`Time by category, ${scopeLabel}`"
      :columns="tableColumns"
      :rows="tableRows"
      :footer="{ name: 'Total', hours: formatHours(totalHours), share: formatPercent(totalHours > 0 ? 1 : 0) }"
    />
  </UiCard>
</template>

<style scoped>
.donut-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  container-type: inline-size;
}

.donut-layout {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-4);
}

/* Wide card (stacked layout): donut beside the legend. */
@container (min-width: 520px) {
  .donut-layout {
    flex-direction: row;
    align-items: center;
    gap: var(--space-8);
  }
  .legend {
    flex: 1 1 auto;
  }
}

.donut-figure {
  margin: 0;
  flex-shrink: 0;
}

.donut-box {
  position: relative;
  width: 180px;
  height: 180px;
  margin: 0 auto;
}

.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.donut-center__value {
  font-size: var(--fs-20);
  line-height: var(--lh-20);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--text-primary);
}

.donut-center__label {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}

.legend {
  min-width: 0;
}

.legend--skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.legend__skeleton-row {
  display: flex;
  align-items: center;
  height: 28px;
}

.legend__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
}

.legend__item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 3.5em;
  align-items: center;
  gap: var(--space-2);
  min-height: 28px;
  font-size: var(--fs-13);
  line-height: var(--lh-13);
}

.legend__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}

.legend__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.legend__hours {
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  text-align: end;
}

.legend__share {
  font-variant-numeric: tabular-nums;
  color: var(--text-tertiary);
  text-align: end;
}

.legend__toggle {
  margin-top: var(--space-1);
  padding: var(--space-1) var(--space-1-5);
  margin-left: calc(-1 * var(--space-1-5));
  border-radius: var(--radius-md);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--accent-text);
  transition: background-color var(--dur-fast) var(--ease-standard);
}
.legend__toggle:hover {
  background-color: var(--accent-subtle);
}

/* Paper: the full category list is in the expanded data table below. */
@media print {
  .legend__toggle {
    display: none;
  }
  .donut-layout {
    break-inside: avoid;
  }
}
</style>
