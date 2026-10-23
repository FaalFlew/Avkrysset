<script setup lang="ts">
/**
 * TaskListCards — the analytics task list on phones and in narrow cards, as semantic list markup
 * (screen readers announce days as headings and tasks as list items; a restyled table can lose
 * its semantics in Safari/VoiceOver). Per day: a heading with the subtotal, then one card per task:
 * title + duration, time ("+1d" when it ends on a later day), then category (organization tasks
 * show their organization once, tagged "Organization"), template (when set) and creator.
 * A card opens its task: the title is a button (Enter/Space), and a tap anywhere on the card does
 * the same. Props, events and focusRow(id) are the same as TaskListTable's (no caption/columns).
 * Props:
 *   days: TaskListPageDay[]; totals: { count, hours }; allCount: number; filtered: boolean
 * Emits: open(row)
 */
import { computed } from "vue";
import { formatDate, formatTimeRange } from "@/lib/datetime";
import { formatDuration } from "@/lib/format";
import type { TaskListPageDay, TaskListRow, TaskListTotals } from "@/lib/taskList";
import { daySummary, endMarker, isRowActivation, totalCountText } from "./taskListView";

const props = defineProps<{
  days: TaskListPageDay[];
  totals: TaskListTotals;
  allCount: number;
  filtered: boolean;
}>();

const emit = defineEmits<{ open: [row: TaskListRow] }>();

const countText = computed(() => totalCountText(props.totals.count, props.allCount, props.filtered));
const headingId = (day: TaskListPageDay) => `task-cards-day-${day.dateKey}`;

const buttons = new Map<string, { focus: () => void }>();
function setButton(id: string, el: unknown): void {
  if (el) buttons.set(id, el as { focus: () => void });
  else buttons.delete(id);
}

function onCardClick(event: MouseEvent, row: TaskListRow): void {
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
  <div class="task-cards">
    <section v-for="day in days" :key="day.dateKey" class="day" :aria-labelledby="headingId(day)">
      <h3 :id="headingId(day)" class="day__head">
        <span class="day__date">{{ formatDate(day.dateKey, "full") }}</span>
        <span class="sr-only">, </span>
        <span class="day__total">{{ daySummary(day) }}</span>
      </h3>
      <ul class="cards" role="list">
        <li
          v-for="row in day.visibleRows"
          :key="row.id"
          class="card"
          :data-task-id="row.id"
          @click="onCardClick($event, row)"
        >
          <div class="card__top">
            <button
              :ref="(el) => setButton(row.id, el)"
              type="button"
              class="title-button"
              aria-haspopup="dialog"
            >
              {{ row.label }}
            </button>
            <span class="card__duration">{{ formatDuration(row.hours) }}</span>
          </div>
          <p class="card__time">
            <span>{{ formatTimeRange(row.start, row.hours) }}</span>
            <template v-if="endMarker(row)">
              <span class="end-marker" aria-hidden="true">{{ endMarker(row)!.text }}</span>
              <span class="sr-only">, {{ endMarker(row)!.spoken }}</span>
            </template>
          </p>
          <p class="card__meta">
            <span class="meta meta--category">
              <span
                class="swatch"
                :style="{ backgroundColor: row.category.color || 'var(--chart-neutral)' }"
                aria-hidden="true"
              ></span>
              <span class="meta__name">{{ row.category.name }}</span>
              <span v-if="row.organizationName" class="org-tag">Organization</span>
            </span>
            <span v-if="row.templateTitle" class="meta meta--template" :class="{ 'is-deleted': row.templateDeleted }">
              Template: {{ row.templateTitle }}
            </span>
            <span class="meta meta--created">Created by {{ row.createdBy }}</span>
          </p>
        </li>
      </ul>
    </section>

    <p class="cards-total">
      <span class="cards-total__label">{{ filtered ? "Total (filtered)" : "Total" }}:</span>
      <span class="cards-total__count">{{ countText }}</span>
      <span class="cards-total__hours">{{ formatDuration(totals.hours) }}</span>
    </p>
  </div>
</template>

<style scoped>
.task-cards {
  display: flex;
  flex-direction: column;
}

.day__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-4);
  margin: 0;
  padding: var(--space-4) 0 var(--space-1-5);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.day:first-child .day__head {
  padding-top: var(--space-1);
}
.day__total {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  font-weight: var(--fw-regular);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.cards {
  margin: 0;
  padding: 0;
  list-style: none;
}

.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 44px;
  margin: 0 calc(-1 * var(--space-2));
  padding: var(--space-2-5) var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-standard);
}
.day:last-of-type .card:last-child {
  border-bottom-color: var(--border-default);
}
.card:hover,
.card:focus-within {
  background-color: var(--bg-subtle);
}

.card__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.title-button {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
  text-align: start;
  overflow-wrap: anywhere;
  cursor: pointer;
  border-radius: var(--radius-xs);
}

.card__duration {
  flex: none;
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.card__time {
  margin: 0;
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
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

.card__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-secondary);
}
.meta {
  min-width: 0;
  overflow-wrap: anywhere;
}
.meta--category {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1-5);
}
.meta__name {
  min-width: 0;
  color: var(--text-primary);
}
.swatch {
  flex-shrink: 0;
  align-self: center;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}
.org-tag {
  flex-shrink: 0;
  padding: 0 var(--space-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xs);
  font-size: var(--fs-11);
  line-height: var(--lh-12);
  color: var(--text-secondary);
}
.meta--template.is-deleted {
  font-style: italic;
}

.cards-total {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
  margin: 0;
  padding-top: var(--space-3);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-variant-numeric: tabular-nums;
}
.cards-total__label {
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.cards-total__count {
  flex: 1 1 auto;
  color: var(--text-secondary);
}
.cards-total__hours {
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
</style>
