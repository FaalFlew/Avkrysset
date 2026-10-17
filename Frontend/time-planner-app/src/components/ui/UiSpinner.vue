<script setup lang="ts">
/**
 * UiSpinner — rotating LoaderCircle.
 * Props:
 *   size?: 14 | 16 | 20 (default 16)
 *   label?: string — when set, renders role="status" with sr-only text; otherwise aria-hidden.
 */
import { LoaderCircle } from "lucide-vue-next";

withDefaults(defineProps<{ size?: 14 | 16 | 20; label?: string }>(), { size: 16, label: undefined });
</script>

<template>
  <span v-if="label" class="ui-spinner" role="status">
    <LoaderCircle class="ui-spinner__icon" :size="size" />
    <span class="sr-only">{{ label }}</span>
  </span>
  <span v-else class="ui-spinner" aria-hidden="true">
    <LoaderCircle class="ui-spinner__icon" :size="size" />
  </span>
</template>

<style scoped>
.ui-spinner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: currentColor;
}

.ui-spinner__icon {
  animation: ui-spin 800ms linear infinite;
}

@keyframes ui-spin {
  to {
    transform: rotate(360deg);
  }
}

/* A loading indicator is essential feedback: keep it turning, just slower. */
@media (prefers-reduced-motion: reduce) {
  .ui-spinner__icon {
    animation-duration: 1600ms !important;
    animation-iteration-count: infinite !important;
  }
}
</style>
