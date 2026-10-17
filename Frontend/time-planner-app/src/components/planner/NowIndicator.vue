<script setup lang="ts">
/**
 * NowIndicator — the current-time marker.
 *   variant 'line': 2px --now line across today's column with a 10px dot at the left edge
 *   variant 'pill': the time ("14:32") in the gutter, on the same row
 * `now` is an epoch-ms value from useNow() (updates on the minute).
 */
import { computed } from "vue";
import { formatTime, minutesSinceStartOfDay, type EpochMs } from "@/lib/datetime";
import { PX_PER_MINUTE } from "./gridConstants";

const props = withDefaults(defineProps<{ now: EpochMs; variant?: "line" | "pill" }>(), { variant: "line" });

const top = computed(() => minutesSinceStartOfDay(props.now) * PX_PER_MINUTE);
const label = computed(() => formatTime(props.now));
</script>

<template>
  <div v-if="variant === 'line'" class="now-line" :style="{ top: `${top}px` }" aria-hidden="true">
    <span class="now-line__dot" />
  </div>
  <div v-else class="now-pill tabular" :style="{ top: `${top}px` }">
    <span class="sr-only">Current time</span>
    {{ label }}
  </div>
</template>

<style scoped>
.now-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  margin-top: -1px;
  z-index: var(--z-grid-now);
  background-color: var(--now);
  pointer-events: none;
}
.now-line__dot {
  position: absolute;
  left: -5px;
  top: -4px;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background-color: var(--now);
}
.now-pill {
  position: absolute;
  right: 4px;
  z-index: var(--z-grid-now);
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  background-color: var(--now-pill-bg);
  color: var(--now-pill-text);
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
  transform: translateY(-50%);
  pointer-events: none;
}
@media (forced-colors: active) {
  .now-line,
  .now-line__dot {
    background-color: Highlight;
  }
  .now-pill {
    border: 1px solid CanvasText;
  }
}
</style>
