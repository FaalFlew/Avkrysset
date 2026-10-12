<script setup lang="ts">
/**
 * UiLoadingBar — 2px indeterminate progress line (e.g. under the planner header).
 * Props:
 *   active: boolean — show/animate the bar (fades in/out)
 *   label?: string — when set and active, exposes role="progressbar" with this aria-label;
 *     otherwise the bar is aria-hidden and the parent announces loading (aria-busy + sr-only text).
 * Under reduced motion the bar is static at 40% opacity.
 * Positioning is up to the parent (it is a block element, 2px tall, full width).
 */
withDefaults(defineProps<{ active: boolean; label?: string }>(), { label: undefined });
</script>

<template>
  <div
    class="ui-loading-bar"
    :class="{ 'is-active': active }"
    :role="active && label ? 'progressbar' : undefined"
    :aria-label="active && label ? label : undefined"
    :aria-hidden="active && label ? undefined : 'true'"
  >
    <span class="ui-loading-bar__indicator" />
  </div>
</template>

<style scoped>
.ui-loading-bar {
  position: relative;
  width: 100%;
  height: 2px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-base) var(--ease-standard);
}
.ui-loading-bar.is-active {
  opacity: 1;
}

.ui-loading-bar__indicator {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 40%;
  border-radius: var(--radius-full);
  background-color: var(--accent);
  transform: translateX(-100%);
}
.ui-loading-bar.is-active .ui-loading-bar__indicator {
  animation: ui-loading-bar-slide 1.2s var(--ease-standard) infinite;
}

@keyframes ui-loading-bar-slide {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-loading-bar.is-active {
    opacity: 0.4;
  }
  .ui-loading-bar.is-active .ui-loading-bar__indicator {
    width: 100%;
    animation: none;
    transform: none;
  }
}

@media (forced-colors: active) {
  .ui-loading-bar__indicator {
    background-color: Highlight;
  }
}
</style>
