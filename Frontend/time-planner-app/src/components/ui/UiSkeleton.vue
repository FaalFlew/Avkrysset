<script setup lang="ts">
/**
 * UiSkeleton — placeholder block with a subtle shimmer (static under reduced motion).
 * Always aria-hidden: the parent sets aria-busy="true" and includes an sr-only "Loading…".
 * Props:
 *   width?: string | number (default '100%'; numbers are px)
 *   height?: string | number (default 12)
 *   radius?: string | number (default var(--radius-sm))
 */
import { computed } from "vue";

const props = withDefaults(
  defineProps<{ width?: string | number; height?: string | number; radius?: string | number }>(),
  { width: "100%", height: 12, radius: "var(--radius-sm)" },
);

function toCss(value: string | number): string {
  return typeof value === "number" ? `${value}px` : value;
}

const style = computed(() => ({
  width: toCss(props.width),
  height: toCss(props.height),
  borderRadius: toCss(props.radius),
}));
</script>

<template>
  <span class="ui-skeleton" :style="style" aria-hidden="true" />
</template>

<style scoped>
.ui-skeleton {
  display: block;
  flex-shrink: 0;
  max-width: 100%;
  background-color: var(--bg-muted);
  background-image: linear-gradient(90deg, var(--bg-subtle) 0%, var(--bg-muted) 50%, var(--bg-subtle) 100%);
  background-size: 200% 100%;
  animation: ui-skeleton-shimmer 1.4s ease-in-out infinite;
}

@keyframes ui-skeleton-shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: -100% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-skeleton {
    animation: none;
    background-image: none;
  }
}

@media (forced-colors: active) {
  .ui-skeleton {
    border: 1px solid GrayText;
  }
}
</style>
