<script setup lang="ts">
/**
 * UiBadge — small status label (20px, fs-12/500).
 * Props:
 *   tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' (default 'neutral')
 *   dotColor?: string — any CSS color; renders an 8px dot before the label (e.g. a category color)
 * Slots: default — label text
 */
import type { Tone } from "./types";

withDefaults(defineProps<{ tone?: Tone; dotColor?: string }>(), { tone: "neutral", dotColor: undefined });
</script>

<template>
  <span class="ui-badge" :class="`ui-badge--${tone}`">
    <span v-if="dotColor" class="ui-badge__dot" :style="{ backgroundColor: dotColor }" aria-hidden="true" />
    <slot />
  </span>
</template>

<style scoped>
.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  height: 20px;
  max-width: 100%;
  padding: 0 var(--space-1-5);
  border-radius: var(--radius-sm);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ui-badge__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

/* Contrast (text on fill): neutral 6.50/5.57, accent 6.05/6.59, success 4.82/6.96,
   warning 4.98/8.50, danger 4.98/6.72 (light/dark). */
.ui-badge--neutral {
  background-color: var(--bg-muted);
  color: var(--text-secondary);
}
.ui-badge--accent {
  background-color: var(--accent-subtle);
  color: var(--accent-text);
}
.ui-badge--success {
  background-color: var(--success-subtle);
  color: var(--success-text);
}
.ui-badge--warning {
  background-color: var(--warning-subtle);
  color: var(--warning-text);
}
.ui-badge--danger {
  background-color: var(--danger-subtle);
  color: var(--danger-text);
}

@media (forced-colors: active) {
  .ui-badge {
    border: 1px solid CanvasText;
  }
}
</style>
