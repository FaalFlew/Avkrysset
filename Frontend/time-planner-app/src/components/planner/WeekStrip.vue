<script setup lang="ts">
/**
 * WeekStrip — phone day switcher under the planner header: ‹ [Mon 5] … [Sun 11] ›.
 * Selected day: accent fill. Today: accent text, semibold. A 4px dot marks days with tasks.
 */
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import UiIconButton from "@/components/ui/UiIconButton.vue";
import { formatDate, formatDayOfMonth, type DateKey } from "@/lib/datetime";
import { formatWeekdayMicro } from "@/lib/plannerFormat";

defineProps<{
  days: readonly DateKey[];
  selected: DateKey;
  today: DateKey;
  /** Days that have at least one task. */
  busyDays: ReadonlySet<DateKey>;
}>();

const emit = defineEmits<{ select: [day: DateKey]; prev: []; next: [] }>();

function label(day: DateKey, today: DateKey, busy: boolean): string {
  const parts = [formatDate(day, "weekday")];
  if (day === today) parts.push("today");
  if (busy) parts.push("has tasks");
  return parts.join(", ");
}
</script>

<template>
  <div class="week-strip">
    <UiIconButton label="Previous week" size="md" :tooltip="false" @click="emit('prev')">
      <ChevronLeft :size="18" />
    </UiIconButton>
    <div class="week-strip__days" role="group" aria-label="Days of this week">
      <button
        v-for="day in days"
        :key="day"
        type="button"
        class="day-pill"
        :class="{ 'is-selected': day === selected, 'is-today': day === today }"
        :aria-pressed="day === selected"
        :aria-label="label(day, today, busyDays.has(day))"
        @click="emit('select', day)"
      >
        <span class="day-pill__weekday" aria-hidden="true">{{ formatWeekdayMicro(day) }}</span>
        <span class="day-pill__date tabular" aria-hidden="true">{{ formatDayOfMonth(day) }}</span>
        <span class="day-pill__dot" :class="{ 'is-visible': busyDays.has(day) }" aria-hidden="true" />
      </button>
    </div>
    <UiIconButton label="Next week" size="md" :tooltip="false" @click="emit('next')">
      <ChevronRight :size="18" />
    </UiIconButton>
  </div>
</template>

<style scoped>
.week-strip {
  display: flex;
  align-items: center;
  gap: 0;
  height: 60px;
  padding: 0 2px;
  border-bottom: 1px solid var(--border-subtle);
  background-color: var(--bg-app);
  flex-shrink: 0;
}
.week-strip__days {
  /* Coarse pointers: chevrons are 40px, so the 7 pills get ≥ 41px each at 375px. */
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
  min-width: 0;
}
@media (pointer: coarse) {
  .week-strip__days {
    gap: 0;
  }
}
.day-pill {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  min-width: 0;
  height: 52px;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  transition: background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.day-pill:hover {
  background-color: var(--bg-subtle);
}
.day-pill__weekday {
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-medium);
  letter-spacing: var(--tracking-caps);
  color: var(--text-tertiary);
}
.day-pill__date {
  font-size: var(--fs-15);
  line-height: var(--lh-15);
  font-weight: var(--fw-semibold);
}
.day-pill__dot {
  width: 4px;
  height: 4px;
  border-radius: var(--radius-full);
  background-color: transparent;
}
.day-pill__dot.is-visible {
  background-color: var(--text-tertiary);
}
.day-pill.is-today .day-pill__date,
.day-pill.is-today .day-pill__weekday {
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}
.day-pill.is-selected {
  background-color: var(--accent);
}
.day-pill.is-selected .day-pill__weekday,
.day-pill.is-selected .day-pill__date {
  color: var(--text-on-accent);
}
.day-pill.is-selected .day-pill__dot.is-visible {
  background-color: var(--text-on-accent);
}
.day-pill:focus-visible {
  outline-offset: 0;
}
</style>
