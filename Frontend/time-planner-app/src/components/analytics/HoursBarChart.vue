<script setup lang="ts">
/**
 * HoursBarChart — "Hours by month|week|day": one bar per period of the selected range
 * (zero-filled), a single series in the theme's chart color, y-axis from zero.
 * Props:
 *   periods: PeriodBar[] — bars in order
 *   view: AnalyticsView — names the period ("month" / "week" / "day")
 *   totalHours: number
 *   scopeLabel: string — range label for the caption ("Jan – Dec 2026")
 *   sparse?: boolean — periods are the server's raw list (empty periods missing)
 *   loading?: boolean — skeleton body
 *   refetching?: boolean — spinner in the header
 * Accessibility: <figure> with an sr-only summary, canvas role="img" + aria-label, and a
 * "View data" table with every value. Tooltips add nothing the table does not have.
 */
import { computed } from "vue";
import { Bar } from "vue-chartjs";
import type { ChartData, ChartOptions, TooltipItem } from "chart.js";
import { UiCard, UiSkeleton, UiSpinner } from "@/components/ui";
import { useBreakpoint } from "@/composables/useMediaQuery";
import { formatHours, formatPercent } from "@/lib/format";
import type { AnalyticsView, PeriodBar } from "@/composables/useStats";
import ChartDataTable from "./ChartDataTable.vue";
import type { DataTableRow } from "./types";
import { clipName, periodNoun } from "./format";
import { setupCharts } from "./chartSetup";
import { tooltipStyle, useChartTheme } from "./useChartTheme";

setupCharts();

const props = withDefaults(
  defineProps<{
    periods: PeriodBar[];
    view: AnalyticsView;
    totalHours: number;
    scopeLabel: string;
    sparse?: boolean;
    loading?: boolean;
    refetching?: boolean;
  }>(),
  { sparse: false, loading: false, refetching: false }
);

const theme = useChartTheme();
const { isMobile } = useBreakpoint();

const title = computed(() => `Hours by ${periodNoun(props.view)}`);

const busiest = computed(() =>
  props.periods.reduce<PeriodBar | null>(
    (best, p) => (p.hours > 0 && (!best || p.hours > best.hours) ? p : best),
    null
  )
);

const summary = computed(() => {
  const parts = [`${title.value}, ${props.scopeLabel}.`];
  if (busiest.value) {
    parts.push(`Highest: ${busiest.value.fullLabel}, ${formatHours(busiest.value.hours)}.`);
  }
  parts.push(`Total ${formatHours(props.totalHours)}.`);
  return parts.join(" ");
});

const chartData = computed<ChartData<"bar">>(() => ({
  labels: props.periods.map((p) => p.label),
  datasets: [
    {
      label: "Hours",
      data: props.periods.map((p) => p.hours),
      backgroundColor: theme.value.bar,
      hoverBackgroundColor: theme.value.barHover,
      borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
      borderSkipped: "start",
      maxBarThickness: 24,
      categoryPercentage: 0.72,
      barPercentage: 0.9,
    },
  ],
}));

const shareOfTotal = (hours: number) =>
  formatPercent(props.totalHours > 0 ? hours / props.totalHours : 0);

function tooltipFooter(period: PeriodBar | undefined): string[] {
  if (!period || period.hours <= 0) return [];
  if (period.categories && period.categories.length > 0) {
    const lines = period.categories
      .slice(0, 3)
      .map((c) => `${clipName(c.name)} · ${formatHours(c.hours)}`);
    const more = period.categories.length - 3;
    if (more > 0) lines.push(`+${more} more`);
    return lines;
  }
  return period.topCategory ? [`Top category: ${period.topCategory}`] : [];
}

const chartOptions = computed<ChartOptions<"bar">>(() => {
  const t = theme.value;
  const periods = props.periods;
  const allZero = periods.every((p) => p.hours <= 0);
  const tickFont = { family: t.fontFamily, size: 11 };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: t.animationMs, easing: "easeOutCubic" },
    layout: { padding: { top: 4, right: 4 } },
    // Hovering anywhere in a period's band shows its tooltip (bigger target than the bar).
    interaction: { mode: "index", intersect: false },
    scales: {
      x: {
        grid: { display: false },
        border: { color: t.axis },
        ticks: {
          color: t.text,
          font: tickFont,
          autoSkip: true,
          maxRotation: 0,
          maxTicksLimit: isMobile.value ? 6 : undefined,
          padding: 6,
        },
      },
      y: {
        beginAtZero: true,
        // An empty range still gets a sensible 0–1 h axis instead of a degenerate one.
        suggestedMax: allZero ? 1 : undefined,
        grid: { color: t.grid, lineWidth: 1, drawTicks: false },
        border: { display: false },
        ticks: {
          color: t.text,
          font: tickFont,
          padding: 8,
          maxTicksLimit: 5,
          callback: (value) => formatHours(Number(value)),
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipStyle(t),
        callbacks: {
          title: (items: TooltipItem<"bar">[]) =>
            periods[items[0]?.dataIndex ?? -1]?.fullLabel ?? "",
          label: (item: TooltipItem<"bar">) => {
            const hours = periods[item.dataIndex]?.hours ?? 0;
            return `${formatHours(hours)} · ${shareOfTotal(hours)} of total`;
          },
          footer: (items: TooltipItem<"bar">[]) =>
            tooltipFooter(periods[items[0]?.dataIndex ?? -1]),
        },
      },
    },
  };
});

const hasCategoryColumn = computed(() => props.periods.some((p) => p.topCategory));

const tableColumns = computed(() => [
  { key: "period", label: periodNoun(props.view).replace(/^./, (c) => c.toUpperCase()) },
  { key: "hours", label: "Hours", align: "end" as const },
  { key: "share", label: "Share", align: "end" as const },
  ...(hasCategoryColumn.value ? [{ key: "top", label: "Top category" }] : []),
]);

const tableRows = computed<DataTableRow[]>(() =>
  props.periods.map((p) => ({
    id: p.key,
    cells: {
      period: p.fullLabel,
      hours: formatHours(p.hours),
      share: shareOfTotal(p.hours),
      top: p.topCategory ?? "—",
    },
  }))
);

const tableFooter = computed(() => ({
  period: "Total",
  hours: formatHours(props.totalHours),
  share: props.totalHours > 0 ? formatPercent(1) : formatPercent(0),
  top: "",
}));
</script>

<template>
  <UiCard :title="title" class="hours-card">
    <template #actions>
      <UiSpinner v-if="refetching" :size="14" />
    </template>

    <div v-if="loading" class="chart-box chart-box--skeleton" aria-hidden="true">
      <UiSkeleton
        v-for="i in 12"
        :key="i"
        :width="'5%'"
        :height="`${20 + ((i * 37) % 70)}%`"
        radius="4px 4px 0 0"
      />
    </div>

    <figure v-else class="chart-figure">
      <figcaption class="sr-only">{{ summary }}</figcaption>
      <div class="chart-box" data-print-size="680x260">
        <Bar :data="chartData" :options="chartOptions" :aria-label="summary" />
      </div>
      <p v-if="sparse" class="chart-note">
        Only periods with planned time are shown for this range.
      </p>
    </figure>

    <ChartDataTable
      :loading="loading"
      :caption="`${title}, ${scopeLabel}`"
      :columns="tableColumns"
      :rows="tableRows"
      :footer="tableFooter"
    />
  </UiCard>
</template>

<style scoped>
.hours-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chart-figure {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  margin: 0;
}

/*
 * The plot box includes the x-axis band (320px; 240px on phones), so the card never scrolls
 * internally. Beside the donut it grows to the row height; the canvas is taken out of flow
 * so Chart.js can shrink it again.
 */
.chart-box {
  position: relative;
  flex: 1 1 auto;
  min-height: 320px;
  min-width: 0;
}
.chart-box :deep(canvas) {
  position: absolute;
  inset: 0;
}

.chart-box--skeleton {
  flex: 0 0 auto;
  height: 320px;
  display: flex;
  align-items: flex-end;
  justify-content: space-around;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2) var(--space-6) var(--space-10);
  border-bottom: 1px solid var(--border-subtle);
}

.chart-note {
  margin-top: var(--space-2);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}

@media (max-width: 767.98px) {
  .chart-box {
    min-height: 240px;
  }
  .chart-box--skeleton {
    height: 240px;
  }
}

/* Paper: usePrintMode redraws the chart at 680×260 (2× pixels); it scales to the page width. */
@media print {
  .chart-box {
    flex: none;
    min-height: 0;
  }
  .chart-box :deep(canvas) {
    position: static;
    width: 100% !important;
    height: auto !important;
  }
  .chart-figure {
    break-inside: avoid;
  }
}
</style>
