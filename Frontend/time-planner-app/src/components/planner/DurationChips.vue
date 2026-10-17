<script setup lang="ts">
/**
 * DurationChips — one-tap durations (15m … 3h) as a radiogroup with roving tabindex.
 * The chip matching `modelValue` (minutes) is selected; none is when the duration is custom.
 * Emits update:modelValue(minutes).
 */
import { computed } from "vue";
import { formatDurationMinutes } from "@/lib/datetime";

const props = withDefaults(defineProps<{ modelValue: number; label?: string; options?: readonly number[] }>(), {
  label: "Duration",
  options: () => [15, 30, 45, 60, 90, 120, 180],
});
const emit = defineEmits<{ "update:modelValue": [minutes: number] }>();

const chipRefs: (HTMLButtonElement | null)[] = [];
function setRef(el: unknown, index: number): void {
  chipRefs[index] = el instanceof HTMLButtonElement ? el : null;
}

const selectedIndex = computed(() => props.options.findIndex((m) => Math.abs(m - props.modelValue) < 0.5));
const tabStop = computed(() => (selectedIndex.value === -1 ? 0 : selectedIndex.value));

function choose(index: number, focus = false): void {
  const minutes = props.options[index];
  if (minutes === undefined) return;
  emit("update:modelValue", minutes);
  if (focus) chipRefs[index]?.focus();
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const count = props.options.length;
  let next = -1;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + count) % count;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = count - 1;
  else if (event.key === " ") {
    event.preventDefault();
    choose(index);
    return;
  }
  if (next === -1) return;
  event.preventDefault();
  event.stopPropagation();
  choose(next, true);
}
</script>

<template>
  <div class="duration-chips" role="radiogroup" :aria-label="label">
    <button
      v-for="(minutes, index) in options"
      :key="minutes"
      :ref="(el) => setRef(el, index)"
      type="button"
      role="radio"
      class="dchip tabular"
      :class="{ 'is-selected': index === selectedIndex }"
      :aria-checked="index === selectedIndex"
      :tabindex="index === tabStop ? 0 : -1"
      @click="choose(index)"
      @keydown="onKeydown($event, index)"
    >
      {{ formatDurationMinutes(minutes) }}
    </button>
  </div>
</template>

<style scoped>
.duration-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.dchip {
  height: 28px;
  padding: 0 var(--space-2-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background-color: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  transition: background-color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}
@media (pointer: coarse) {
  .dchip {
    height: 36px;
    min-width: 44px;
  }
}
.dchip:hover {
  background-color: var(--bg-subtle);
  color: var(--text-primary);
}
.dchip.is-selected {
  border-color: var(--accent-border);
  background-color: var(--accent-subtle);
  color: var(--accent-text);
}
@media (forced-colors: active) {
  .dchip.is-selected {
    outline: 2px solid Highlight;
  }
}
</style>
