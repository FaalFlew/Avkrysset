<script setup lang="ts">
/**
 * KpiTiles — the four headline numbers for the selected range:
 * total time, average per period (empty periods included), busiest period, top category.
 * Props:
 *   snapshot: AnalyticsSnapshot | null — data for the range (null while loading)
 *   scopeLabel: string — short range label for the "Total time" sub line ("Jan – Dec 2026")
 *   loading?: boolean — render skeleton tiles
 */
import { computed } from "vue";
import { UiSkeleton } from "@/components/ui";
import { formatHours, formatPercent } from "@/lib/format";
import { monthNames } from "@/lib/datetime";
import { analyticsBuckets } from "@/lib/analyticsBuckets";
import type { AnalyticsSnapshot } from "@/composables/useStats";
import { periodCount, periodNoun } from "./format";

const props = withDefaults(
  defineProps<{
    snapshot: AnalyticsSnapshot | null;
    scopeLabel: string;
    loading?: boolean;
  }>(),
  { loading: false }
);

interface Tile {
  id: string;
  label: string;
  value: string;
  sub: string;
  /** Category color shown as a dot before the value. */
  dot?: string | null;
  /** Long values (names) use a smaller size and truncate. */
  text?: boolean;
  title?: string;
}

const tiles = computed<Tile[]>(() => {
  const s = props.snapshot;
  if (!s) return [];
  const view = s.selection.view;
  const noun = periodNoun(view);
  const total = s.totalHours;
  // Every period of the range counts, including empty ones (an honest average).
  const periods = analyticsBuckets(s.selection).length;

  let busiest: (typeof s.periods)[number] | null = null;
  for (const period of s.periods) {
    if (period.hours > 0 && (!busiest || period.hours > busiest.hours)) busiest = period;
  }
  const busiestName = busiest
    ? view === "monthly"
      ? (monthNames("long")[Number(busiest.key.slice(5, 7)) - 1] ?? busiest.label)
      : busiest.label
    : "—";

  const top = s.categories[0];

  return [
    {
      id: "total",
      label: "Total time",
      value: formatHours(total),
      sub: props.scopeLabel,
    },
    {
      id: "average",
      label: `Average per ${noun}`,
      value: periods > 0 ? formatHours(total / periods) : "—",
      sub: periods > 0 ? `across ${periodCount(view, periods)}` : "Not available",
    },
    {
      id: "busiest",
      label: `Busiest ${noun}`,
      value: busiestName,
      sub: busiest
        ? `${formatHours(busiest.hours)} · ${formatPercent(total > 0 ? busiest.hours / total : 0)}`
        : "No time planned",
      title: busiest?.fullLabel,
    },
    {
      id: "top-category",
      label: "Top category",
      value: top ? top.name : "—",
      sub: top ? `${formatHours(top.hours)} · ${formatPercent(top.share)}` : "No time planned",
      dot: top ? top.color : undefined,
      text: !!top,
      title: top?.name,
    },
  ];
});
</script>

<template>
  <div class="kpi-grid" :aria-busy="loading || undefined">
    <div v-if="loading" class="kpi-list" aria-hidden="true">
      <div v-for="i in 4" :key="i" class="kpi">
        <span class="kpi__label kpi__skel"><UiSkeleton width="45%" :height="10" /></span>
        <span class="kpi__value kpi__skel"><UiSkeleton width="60%" :height="24" /></span>
        <span class="kpi__sub kpi__skel"><UiSkeleton width="50%" :height="10" /></span>
      </div>
    </div>
    <dl v-else class="kpi-list">
      <div v-for="tile in tiles" :key="tile.id" class="kpi">
        <dt class="kpi__label">{{ tile.label }}</dt>
        <dd class="kpi__value" :class="{ 'kpi__value--text': tile.text }" :title="tile.title">
          <span
            v-if="tile.dot !== undefined"
            class="kpi__dot"
            :style="{ backgroundColor: tile.dot || 'var(--chart-neutral)' }"
            aria-hidden="true"
          ></span>
          <span class="kpi__value-text">{{ tile.value }}</span>
        </dd>
        <dd class="kpi__sub">{{ tile.sub }}</dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.kpi-grid {
  container-type: inline-size;
}

.kpi-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
}

@container (min-width: 760px) {
  .kpi-list {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-4);
  }
}

.kpi {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background-color: var(--bg-surface);
}


.kpi__label {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
}

.kpi__value {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  font-size: var(--fs-28);
  line-height: var(--lh-28);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tighter);
  color: var(--text-primary);
  /* Proportional figures on hero values (tabular only in columns). */
  font-variant-numeric: proportional-nums;
}

.kpi__value--text {
  font-size: var(--fs-17);
  line-height: var(--lh-28);
  letter-spacing: var(--tracking-tight);
}

.kpi__value-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kpi__dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
}

.kpi__sub {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}

/* Skeleton lines take exactly the height of the text they stand in for (no layout jump). */
.kpi__skel {
  display: flex;
  align-items: center;
  height: var(--lh-12);
}
.kpi__value.kpi__skel {
  height: var(--lh-28);
}

@media (max-width: 767.98px) {
  .kpi__value.kpi__skel {
    height: var(--lh-24);
  }
  .kpi {
    padding: var(--space-3);
  }
  .kpi__value {
    font-size: var(--fs-24);
    line-height: var(--lh-24);
  }
  .kpi__value--text {
    font-size: var(--fs-15);
    line-height: var(--lh-24);
  }
}

/* Paper: one row of four, slightly smaller values. */
@media print {
  .kpi-list {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .kpi {
    padding: var(--space-3);
    break-inside: avoid;
  }
  .kpi__value {
    font-size: var(--fs-24);
    line-height: var(--lh-24);
  }
  .kpi__value--text {
    font-size: var(--fs-15);
  }
}
</style>
