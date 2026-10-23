<script setup lang="ts">
/**
 * UiCard — flat bordered surface (no shadow).
 * Props:
 *   title?: string — card heading (fs-15/600)
 *   caption?: string — secondary line under the title (fs-13, secondary)
 *   padding?: 'md' (16) | 'lg' (20) | 'none' (default 'md')
 *   headingLevel?: 2 | 3 | 4 (default 2)
 *   as?: string — root element tag (default 'section')
 * Slots:
 *   actions — right side of the header row (buttons, spinner, …)
 *   default — body
 */
import { computed, useId, useSlots } from "vue";

const props = withDefaults(
  defineProps<{
    title?: string;
    caption?: string;
    padding?: "md" | "lg" | "none";
    headingLevel?: 2 | 3 | 4;
    as?: string;
  }>(),
  { title: undefined, caption: undefined, padding: "md", headingLevel: 2, as: "section" },
);

const slots = useSlots();
const titleId = `ui-card-${useId()}`;
const hasHeader = computed(() => !!props.title || !!props.caption || !!slots.actions);
</script>

<template>
  <component
    :is="as"
    class="ui-card"
    :class="`ui-card--pad-${padding}`"
    :aria-labelledby="title && as === 'section' ? titleId : undefined"
  >
    <header v-if="hasHeader" class="ui-card__header">
      <div v-if="title || caption" class="ui-card__heading">
        <component :is="`h${headingLevel}`" v-if="title" :id="titleId" class="ui-card__title">{{ title }}</component>
        <p v-if="caption" class="ui-card__caption">{{ caption }}</p>
      </div>
      <div v-if="$slots.actions" class="ui-card__actions"><slot name="actions" /></div>
    </header>
    <slot />
  </component>
</template>

<style scoped>
.ui-card {
  --_pad: var(--space-4);
  min-width: 0;
  padding: var(--_pad);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background-color: var(--bg-surface);
  color: var(--text-primary);
}
.ui-card--pad-lg {
  --_pad: var(--space-5);
}
.ui-card--pad-none {
  --_pad: 0px;
  overflow: hidden;
}

.ui-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.ui-card--pad-none .ui-card__header {
  margin-bottom: 0;
  padding: var(--space-4) var(--space-4) var(--space-3);
}

.ui-card__heading {
  min-width: 0;
}

.ui-card__title {
  margin: 0;
  font-size: var(--fs-15);
  line-height: var(--lh-15);
  font-weight: var(--fw-semibold);
  letter-spacing: normal;
  color: var(--text-primary);
}

.ui-card__caption {
  margin-top: var(--space-0-5);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}

.ui-card__actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
}
</style>
