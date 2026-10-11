<script setup lang="ts">
/**
 * UiErrorState — centered error block with a retry button (role="alert").
 * Props:
 *   title?: string (default "Something went wrong")
 *   description?: string
 *   retryLabel?: string (default "Try again")
 *   retrying?: boolean — retry button shows a loading state
 *   hideRetry?: boolean — omit the retry button
 *   size?: 'md' | 'sm' (default 'md')
 *   headingLevel?: 2 | 3 | 4 (default 2)
 * Emits: retry()
 * Slots: actions — extra buttons next to retry
 */
import { RotateCw, TriangleAlert } from "lucide-vue-next";
import UiButton from "./UiButton.vue";

withDefaults(
  defineProps<{
    title?: string;
    description?: string;
    retryLabel?: string;
    retrying?: boolean;
    hideRetry?: boolean;
    size?: "md" | "sm";
    headingLevel?: 2 | 3 | 4;
  }>(),
  {
    title: "Something went wrong",
    description: undefined,
    retryLabel: "Try again",
    retrying: false,
    hideRetry: false,
    size: "md",
    headingLevel: 2,
  },
);

const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="ui-error" :class="`ui-error--${size}`" role="alert">
    <span class="ui-error__icon" aria-hidden="true">
      <TriangleAlert :size="20" />
    </span>
    <component :is="`h${headingLevel}`" class="ui-error__title">{{ title }}</component>
    <p v-if="description" class="ui-error__description">{{ description }}</p>
    <div v-if="!hideRetry || $slots.actions" class="ui-error__actions">
      <UiButton v-if="!hideRetry" variant="secondary" :loading="retrying" @click="emit('retry')">
        <template #leading><RotateCw :size="16" /></template>
        {{ retryLabel }}
      </UiButton>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.ui-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 360px;
  margin: 0 auto;
  padding: var(--space-12) var(--space-4);
  text-align: center;
}
.ui-error--sm {
  padding: var(--space-6) var(--space-3);
}

.ui-error__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-bottom: var(--space-3);
  border-radius: var(--radius-full);
  background-color: var(--danger-subtle);
  color: var(--danger-text);
}

.ui-error__title {
  margin: 0;
  font-size: var(--fs-15);
  line-height: var(--lh-15);
  font-weight: var(--fw-semibold);
  letter-spacing: normal;
  color: var(--text-primary);
}

.ui-error__description {
  margin-top: var(--space-1);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}

.ui-error__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
</style>
