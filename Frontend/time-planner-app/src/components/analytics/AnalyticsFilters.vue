<script setup lang="ts">
/**
 * AnalyticsFilters — the single filter row that scopes everything on the analytics page:
 * group by (Month / Week / Day), year, the range for that grouping, and Reset.
 * Models (v-model:*):
 *   view: AnalyticsView
 *   year: number — calendar year (Month) or ISO week-year (Week, Day)
 *   monthRange: { start, end } — 0-based months, inclusive
 *   weekRange: { start, end } — ISO weeks, inclusive
 *   dailyWeek: number — ISO week shown by the Day grouping
 * Props:
 *   years: number[] — years offered in the year select
 *   canReset?: boolean — show the Reset button (the range differs from the default)
 * Emits: reset()
 */
import { computed } from "vue";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-vue-next";
import {
  UiButton,
  UiIconButton,
  UiSegmentedControl,
  UiSelect,
  type SegmentOption,
  type SelectOption,
} from "@/components/ui";
import { useBreakpoint } from "@/composables/useMediaQuery";
import { isoWeekBounds, weekRangeOptionLabel, weekStartOptionLabel } from "./format";
import { formatDate, isoWeeksInYear, monthNames } from "@/lib/datetime";
import type { AnalyticsView } from "@/lib/analyticsBuckets";

interface Span {
  start: number;
  end: number;
}

const view = defineModel<AnalyticsView>("view", { required: true });
const year = defineModel<number>("year", { required: true });
const monthRange = defineModel<Span>("monthRange", { required: true });
const weekRange = defineModel<Span>("weekRange", { required: true });
const dailyWeek = defineModel<number>("dailyWeek", { required: true });

const props = withDefaults(defineProps<{ years: number[]; canReset?: boolean }>(), {
  canReset: false,
});
const emit = defineEmits<{ reset: [] }>();

const { isMobile } = useBreakpoint();

const viewOptions: SegmentOption<AnalyticsView>[] = [
  { value: "monthly", label: "Month" },
  { value: "weekly", label: "Week" },
  { value: "daily", label: "Day" },
];

const yearOptions = computed<SelectOption<number>[]>(() =>
  props.years.map((y) => ({ value: y, label: String(y) }))
);

const shortMonths = monthNames("short");
const weekCount = computed(() => isoWeeksInYear(year.value));

const monthStartOptions = computed<SelectOption<number>[]>(() =>
  shortMonths.map((label, i) => ({ value: i, label, disabled: i > monthRange.value.end }))
);
const monthEndOptions = computed<SelectOption<number>[]>(() =>
  shortMonths.map((label, i) => ({ value: i, label, disabled: i < monthRange.value.start }))
);

const weekStartOptions = computed<SelectOption<number>[]>(() =>
  Array.from({ length: weekCount.value }, (_, i) => ({
    value: i + 1,
    label: weekStartOptionLabel(year.value, i + 1),
    disabled: i + 1 > weekRange.value.end,
  }))
);
const weekEndOptions = computed<SelectOption<number>[]>(() =>
  Array.from({ length: weekCount.value }, (_, i) => ({
    value: i + 1,
    label: `W${i + 1} · ${formatDate(isoWeekBounds(year.value, i + 1).end, "monthDay")}`,
    disabled: i + 1 < weekRange.value.start,
  }))
);
const dayWeekOptions = computed<SelectOption<number>[]>(() =>
  Array.from({ length: weekCount.value }, (_, i) => ({
    value: i + 1,
    label: weekRangeOptionLabel(year.value, i + 1),
  }))
);

const setMonth = (key: keyof Span, value: number) => {
  monthRange.value = { ...monthRange.value, [key]: value };
};
const setWeek = (key: keyof Span, value: number) => {
  weekRange.value = { ...weekRange.value, [key]: value };
};

/** Step the Day grouping by one ISO week, crossing into the neighbouring week-year. */
function shiftWeek(delta: -1 | 1): void {
  let nextYear = year.value;
  let nextWeek = dailyWeek.value + delta;
  if (nextWeek < 1) {
    nextYear -= 1;
    nextWeek = isoWeeksInYear(nextYear);
  } else if (nextWeek > isoWeeksInYear(nextYear)) {
    nextYear += 1;
    nextWeek = 1;
  }
  year.value = nextYear;
  dailyWeek.value = nextWeek;
}
</script>

<template>
  <div class="filters" role="group" aria-label="Analytics filters">
    <UiSegmentedControl
      v-model="view"
      class="filters__grouping"
      :options="viewOptions"
      aria-label="Group by"
      :block="isMobile"
    />

    <div class="filters__row">
      <UiSelect v-model="year" class="filters__year" :options="yearOptions" label="Year" hide-label />

      <div v-if="view === 'monthly'" class="filters__range">
        <span class="filters__word" aria-hidden="true">From</span>
        <UiSelect
          :model-value="monthRange.start"
          :options="monthStartOptions"
          class="filters__select filters__select--month"
          label="First month"
          hide-label
          @update:model-value="setMonth('start', $event)"
        />
        <span class="filters__word" aria-hidden="true">to</span>
        <UiSelect
          :model-value="monthRange.end"
          :options="monthEndOptions"
          class="filters__select filters__select--month"
          label="Last month"
          hide-label
          @update:model-value="setMonth('end', $event)"
        />
      </div>

      <div v-else-if="view === 'weekly'" class="filters__range">
        <span class="filters__word" aria-hidden="true">From</span>
        <UiSelect
          :model-value="weekRange.start"
          :options="weekStartOptions"
          class="filters__select filters__select--week"
          label="First week"
          hide-label
          @update:model-value="setWeek('start', $event)"
        />
        <span class="filters__word" aria-hidden="true">to</span>
        <UiSelect
          :model-value="weekRange.end"
          :options="weekEndOptions"
          class="filters__select filters__select--week"
          label="Last week"
          hide-label
          @update:model-value="setWeek('end', $event)"
        />
      </div>

      <div v-else class="filters__range filters__range--stepper">
        <UiIconButton label="Previous week" variant="secondary" @click="shiftWeek(-1)">
          <ChevronLeft :size="16" />
        </UiIconButton>
        <UiSelect
          v-model="dailyWeek"
          class="filters__week"
          :options="dayWeekOptions"
          label="Week"
          hide-label
        />
        <UiIconButton label="Next week" variant="secondary" @click="shiftWeek(1)">
          <ChevronRight :size="16" />
        </UiIconButton>
      </div>

      <UiButton v-if="canReset" variant="ghost" size="sm" class="filters__reset" @click="emit('reset')">
        <template #leading><RotateCcw :size="16" /></template>
        Reset
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.filters__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  min-width: 0;
}

.filters__year {
  width: 96px;
}

.filters__range {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.filters__range--stepper {
  gap: var(--space-1-5);
}

.filters__word {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
  white-space: nowrap;
}

.filters__select--month {
  width: 6.5rem;
}

.filters__select--week {
  width: 9.5rem;
}

.filters__week {
  min-width: 0;
  width: 15.5rem;
}

@media (max-width: 767.98px) {
  .filters {
    flex-direction: column;
    align-items: stretch;
  }
  .filters__grouping {
    width: 100%;
  }
  .filters__range {
    flex: 1 1 auto;
  }
  .filters__select,
  .filters__week {
    flex: 1 1 0;
    min-width: 0;
    width: auto;
  }
}
</style>
