<script setup lang="ts">
/**
 * AppLogo — "time blocks" mark (accent square with two white bars) + optional wordmark.
 * Props:
 *   size?: number — mark size in px (default 22)
 *   withWordmark?: boolean — show "Time Planner" (fs-14/600) next to the mark
 *   decorative?: boolean — when true and there is no wordmark, no accessible name is added
 *     (use inside a control that already has a label)
 */
withDefaults(defineProps<{ size?: number; withWordmark?: boolean; decorative?: boolean }>(), {
  size: 22,
  withWordmark: false,
  decorative: false,
});
</script>

<template>
  <span class="app-logo">
    <svg
      class="app-logo__mark"
      :width="size"
      :height="size"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect class="app-logo__bg" width="24" height="24" rx="6" />
      <rect class="app-logo__bar" x="6" y="7.5" width="12" height="3" rx="1.5" />
      <rect class="app-logo__bar" x="6" y="13.5" width="7.5" height="3" rx="1.5" />
    </svg>
    <span v-if="withWordmark" class="app-logo__wordmark">Time Planner</span>
    <span v-else-if="!decorative" class="sr-only">Time Planner</span>
  </span>
</template>

<style scoped>
.app-logo {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-primary);
}

.app-logo__mark {
  display: block;
  flex-shrink: 0;
}
.app-logo__bg {
  fill: var(--accent);
}
.app-logo__bar {
  fill: var(--text-on-accent);
}

.app-logo__wordmark {
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  white-space: nowrap;
}

@media (forced-colors: active) {
  .app-logo__bg {
    fill: CanvasText;
  }
  .app-logo__bar {
    fill: Canvas;
  }
}
</style>
