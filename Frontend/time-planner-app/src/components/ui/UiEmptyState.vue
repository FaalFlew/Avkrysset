<script setup lang="ts">
/**
 * UiEmptyState — centered "nothing here yet" block (max-width 360).
 * Props:
 *   icon?: Component — lucide icon, shown at 20px in a 40px --bg-subtle circle
 *   title: string — fs-15/600
 *   description?: string — fs-13 secondary
 *   size?: 'md' | 'sm' (default 'md'; sm = tighter padding, for inside cards)
 *   headingLevel?: 2 | 3 | 4 (default 2)
 * Slots:
 *   actions — buttons, 16px below the text
 *   default — extra content under the description
 */
import type { Component } from "vue";

withDefaults(
  defineProps<{
    icon?: Component;
    title: string;
    description?: string;
    size?: "md" | "sm";
    headingLevel?: 2 | 3 | 4;
  }>(),
  { icon: undefined, description: undefined, size: "md", headingLevel: 2 },
);
</script>

<template>
  <div class="ui-empty" :class="`ui-empty--${size}`">
    <span v-if="icon" class="ui-empty__icon" aria-hidden="true">
      <component :is="icon" :size="20" />
    </span>
    <component :is="`h${headingLevel}`" class="ui-empty__title">{{ title }}</component>
    <p v-if="description" class="ui-empty__description">{{ description }}</p>
    <slot />
    <div v-if="$slots.actions" class="ui-empty__actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 360px;
  margin: 0 auto;
  padding: var(--space-12) var(--space-4);
  text-align: center;
}
.ui-empty--sm {
  padding: var(--space-6) var(--space-3);
}

.ui-empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-bottom: var(--space-3);
  border-radius: var(--radius-full);
  background-color: var(--bg-subtle);
  color: var(--text-tertiary);
}

.ui-empty__title {
  margin: 0;
  font-size: var(--fs-15);
  line-height: var(--lh-15);
  font-weight: var(--fw-semibold);
  letter-spacing: normal;
  color: var(--text-primary);
}

.ui-empty__description {
  margin-top: var(--space-1);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}

.ui-empty__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
</style>
