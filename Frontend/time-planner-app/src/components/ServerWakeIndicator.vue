<!-- src/components/ServerWakeIndicator.vue -->
<script setup lang="ts">
/**
 * ServerWakeIndicator — non-blocking "Waking up the server…" pill while a change (create / update
 * / delete) has been waiting for the API for more than 3 s, typically a cold start
 * (services/slowRequests.ts). Mount once (App.vue, app shell only: the sign-in pages have their
 * own hint). Nothing to click; the change completes (or fails with a toast) on its own.
 *
 * Position: bottom center like the toast (above the phone tab bar, centered over the main column
 * next to the sidebar/rail); it moves up while a toast is visible so the two never overlap.
 * Teleported to <body> so it also shows above the task editor dialog that is saving.
 * Accessibility: a persistent polite live region announces it once when it appears.
 */
import { computed } from "vue";
import UiSpinner from "@/components/ui/UiSpinner.vue";
import { isMutationSlow } from "@/services/slowRequests";
import { useUIStore } from "@/stores/uiStore";

const uiStore = useUIStore();
const raised = computed(() => uiStore.toast.isVisible);
</script>

<template>
  <Teleport to="body">
    <div class="wake-region" :class="{ 'wake-region--raised': raised }" data-overlay-ignore>
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {{ isMutationSlow ? "Saving is taking longer than usual: waking up the server." : "" }}
      </div>
      <Transition name="wake">
        <p v-if="isMutationSlow" class="wake-pill" aria-hidden="true">
          <UiSpinner :size="14" />
          <span>Waking up the server…</span>
          <span class="wake-pill__more">this can take a few seconds.</span>
        </p>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.wake-region {
  position: fixed;
  left: 50%;
  bottom: var(--toast-offset);
  z-index: var(--z-toast);
  display: flex;
  justify-content: center;
  width: min(440px, calc(100vw - 32px));
  transform: translateX(-50%);
  pointer-events: none;
  transition: bottom var(--dur-base) var(--ease-standard);
}
/* Above a visible toast (one line of toast ≈ 44px, plus a gap). */
.wake-region--raised {
  bottom: calc(var(--toast-offset) + 56px);
}

.wake-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  padding: var(--space-1-5) var(--space-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background-color: var(--bg-raised);
  box-shadow: var(--shadow-sm);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}

/* Phones: the short form only, so the pill stays clear of the floating "New task" button. */
@media (max-width: 767.98px) {
  .wake-pill__more {
    display: none;
  }
}

.wake-enter-active,
.wake-leave-active {
  transition: opacity var(--dur-fast) var(--ease-standard);
}
.wake-enter-from,
.wake-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .wake-region {
    transition: none;
  }
}
</style>

<style>
/* Center over the main column next to the sidebar/rail (≥ 768px), like the toast. */
@media (min-width: 768px) {
  body:has(.app-shell--expanded) .wake-region {
    left: calc(50% + (var(--sidebar-w) + 1px) / 2);
  }
  body:has(.app-shell--rail) .wake-region {
    left: calc(50% + (var(--rail-w) + 1px) / 2);
  }
}
</style>
