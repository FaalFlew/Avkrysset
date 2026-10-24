<script setup lang="ts">
/**
 * UiPageHeader — page title row.
 * Props:
 *   title: string — the page <h1> (tabindex="-1" + data-page-heading so route changes can focus it)
 *   subtitle?: string — fs-14 secondary line under the title
 *   eyebrow?: string — small accent label above the title (e.g. "Today")
 *   size?: 'md' (fs-20; fs-17 on mobile) | 'lg' (fs-24, Today) — default 'md'
 * Slots:
 *   title — custom content inside the <h1> (e.g. a month-picker button); defaults to `title`
 *   actions — right side of the title row
 *   default — below the row (filters etc.)
 */
withDefaults(
  defineProps<{ title: string; subtitle?: string; eyebrow?: string; size?: "md" | "lg" }>(),
  { subtitle: undefined, eyebrow: undefined, size: "md" },
);
</script>

<template>
  <header class="ui-page-header" :class="`ui-page-header--${size}`">
    <div class="ui-page-header__row">
      <div class="ui-page-header__titles">
        <p v-if="eyebrow" class="ui-page-header__eyebrow">{{ eyebrow }}</p>
        <h1 class="ui-page-header__title" tabindex="-1" data-page-heading>
          <slot name="title">{{ title }}</slot>
        </h1>
        <p v-if="subtitle" class="ui-page-header__subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="ui-page-header__actions"><slot name="actions" /></div>
    </div>
    <div v-if="$slots.default" class="ui-page-header__extra"><slot /></div>
  </header>
</template>

<style scoped>
.ui-page-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.ui-page-header__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.ui-page-header__titles {
  min-width: 0;
  flex: 1 1 auto;
}

.ui-page-header__eyebrow {
  margin-bottom: var(--space-0-5);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--accent-text);
}

.ui-page-header__title {
  margin: 0;
  font-size: var(--fs-20);
  line-height: var(--lh-20);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--text-primary);
}
.ui-page-header__title:focus {
  outline: none;
}
.ui-page-header--lg .ui-page-header__title {
  font-size: var(--fs-24);
  line-height: var(--lh-24);
  letter-spacing: var(--tracking-tighter);
}

.ui-page-header__subtitle {
  margin-top: var(--space-1);
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  color: var(--text-secondary);
}

.ui-page-header__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

@media (max-width: 767.98px) {
  .ui-page-header--md .ui-page-header__title {
    font-size: var(--fs-17);
    line-height: var(--lh-17);
  }
}
</style>
