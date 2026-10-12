<script setup lang="ts">
/**
 * AuthLayout — page frame for the auth screens (login, register, password reset, email flows).
 * Landmarks: <header> (logo + theme toggle) and <main id="main"> (card + footer links).
 * Props:
 *   title: string — the page <h1> (tabindex="-1", data-page-heading)
 *   subtitle?: string — fs-14 secondary under the title
 *   tone?: 'accent' | 'success' | 'danger' | 'neutral' — color of the status icon circle
 *     (only used with the `icon` slot; default 'accent')
 *   centered?: boolean — center the card text (status screens)
 * Slots:
 *   icon — status icon (lucide, :size="20") shown in a 44px circle above the title
 *   default — card body (forms use .auth-form spacing automatically when you add class="auth-form")
 *   footer — links under the card (fs-13 secondary, centered)
 * Exposes: focusHeading() — move focus to the h1 (e.g. after switching to a success state)
 */
import { ref, useId } from "vue";
import { RouterLink } from "vue-router";
import AppLogo from "@/components/ui/AppLogo.vue";
import UiThemeToggle from "@/components/ui/UiThemeToggle.vue";

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    tone?: "accent" | "success" | "danger" | "neutral";
    centered?: boolean;
  }>(),
  { subtitle: undefined, tone: "accent", centered: false },
);

const titleId = `auth-title-${useId()}`;
const heading = ref<HTMLElement | null>(null);

function focusHeading(): void {
  heading.value?.focus({ preventScroll: false });
}

defineExpose({ focusHeading });
</script>

<template>
  <div class="auth-layout">
    <header class="auth-layout__header">
      <RouterLink to="/" class="auth-layout__brand">
        <AppLogo :size="26" with-wordmark />
      </RouterLink>
      <div class="auth-layout__theme">
        <UiThemeToggle variant="cycle" />
      </div>
    </header>

    <main id="main" class="auth-layout__main">
      <section class="auth-card" :class="{ 'auth-card--centered': centered }" :aria-labelledby="titleId">
        <div v-if="$slots.icon" class="auth-card__icon" :class="`auth-card__icon--${tone}`" aria-hidden="true">
          <slot name="icon" />
        </div>
        <div class="auth-card__head">
          <h1 :id="titleId" ref="heading" class="auth-card__title" tabindex="-1" data-page-heading>{{ title }}</h1>
          <p v-if="subtitle || $slots.subtitle" class="auth-card__subtitle">
            <slot name="subtitle">{{ subtitle }}</slot>
          </p>
        </div>
        <slot />
      </section>

      <div v-if="$slots.footer" class="auth-layout__footer">
        <slot name="footer" />
      </div>
    </main>
  </div>
</template>

<style scoped>
.auth-layout {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 0 var(--space-4) var(--space-12);
  background-color: var(--bg-app);
  color: var(--text-primary);
}

.auth-layout__header {
  position: relative;
  display: flex;
  justify-content: center;
  padding-top: var(--space-12);
}

.auth-layout__brand {
  display: inline-flex;
  border-radius: var(--radius-sm);
  color: inherit;
  text-decoration: none;
}
.auth-layout__brand :deep(.app-logo__wordmark) {
  font-size: var(--fs-15);
  line-height: var(--lh-15);
}

.auth-layout__theme {
  position: absolute;
  top: var(--space-3);
  right: 0;
}

.auth-layout__main {
  width: 100%;
  max-width: 400px;
  margin: var(--space-6) auto 0;
}

/* ---------- card ---------- */
.auth-card {
  padding: var(--space-8);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background-color: var(--bg-surface);
  box-shadow: var(--shadow-sm);
}
.auth-card--centered {
  text-align: center;
}

.auth-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-bottom: var(--space-4);
  border-radius: var(--radius-full);
}
.auth-card--centered .auth-card__icon {
  margin-inline: auto;
}
.auth-card__icon--accent {
  background-color: var(--accent-subtle);
  color: var(--accent-text);
}
.auth-card__icon--success {
  background-color: var(--success-subtle);
  color: var(--success-text);
}
.auth-card__icon--danger {
  background-color: var(--danger-subtle);
  color: var(--danger-text);
}
.auth-card__icon--neutral {
  background-color: var(--bg-subtle);
  color: var(--text-tertiary);
}

.auth-card__head {
  margin-bottom: var(--space-6);
}
.auth-card__head:last-child {
  margin-bottom: 0;
}

.auth-card__title {
  margin: 0;
  font-size: var(--fs-20);
  line-height: var(--lh-20);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--text-primary);
}
.auth-card__title:focus {
  outline: none;
}

.auth-card__subtitle {
  margin-top: var(--space-1-5);
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

/* ---------- shared building blocks for the auth views (slot content) ---------- */
:slotted(.auth-form) {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
:slotted(.auth-field-group) {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
:slotted(.auth-submit) {
  margin-top: var(--space-2);
}
:slotted(.auth-alert) {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2-5) var(--space-3);
  border: 1px solid var(--danger-border);
  border-radius: var(--radius-md);
  background-color: var(--danger-subtle);
  color: var(--danger-text);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  text-align: left;
}
:slotted(.auth-alert .lucide) {
  margin-top: 1px;
}
:slotted(.auth-hint) {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}
:slotted(.auth-hint:not(:empty)) {
  margin-top: var(--space-3);
}
:slotted(.auth-text) {
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
:slotted(.auth-text strong) {
  color: var(--text-primary);
}
:slotted(.auth-text + .auth-text) {
  margin-top: var(--space-2);
}
:slotted(.auth-actions) {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
:slotted(.auth-section) {
  margin-top: var(--space-6);
  padding-top: var(--space-5);
  border-top: 1px solid var(--border-subtle);
}
:slotted(.auth-link-sm) {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  text-decoration: none;
}
:slotted(.auth-link-sm:hover) {
  text-decoration: underline;
}
:slotted(.auth-divider) {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  color: var(--text-tertiary);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
}
:slotted(.auth-divider)::before,
:slotted(.auth-divider)::after {
  content: "";
  flex: 1;
  height: 1px;
  background-color: var(--border-default);
}

/* ---------- footer links ---------- */
.auth-layout__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-6);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
  text-align: center;
}

@media (max-width: 767.98px) {
  .auth-layout__header {
    padding-top: var(--space-10);
  }
  .auth-card {
    padding: var(--space-6);
  }
}

/* Small phones: no card chrome, the page is the card. */
@media (max-width: 479.98px) {
  .auth-layout__header {
    justify-content: flex-start;
    padding-top: var(--space-4);
  }
  .auth-layout__theme {
    top: var(--space-2);
  }
  .auth-layout__main {
    margin-top: var(--space-8);
  }
  .auth-card {
    padding: 0;
    border: 0;
    border-radius: 0;
    background-color: transparent;
    box-shadow: none;
  }
}

@media (forced-colors: active) {
  .auth-card {
    border: 1px solid CanvasText;
  }
}
</style>
