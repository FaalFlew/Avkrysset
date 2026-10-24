<!-- src/components/ToastNotification.vue -->
<script setup lang="ts">
/**
 * ToastNotification — renders uiStore.toast at the bottom center (above the mobile tab bar).
 * Mount once (App.vue). Teleported to <body> so it stays usable while a modal makes #app inert.
 *
 * Action: when the store toast carries `action: ToastAction` ({ label, onClick }), an action
 * button is shown; clicking hides the toast, then runs onClick().
 * Countdown: paused (uiStore.pauseToast/resumeToast) while the pointer is over the toast or focus
 * is inside it.
 *
 * Accessibility: persistent sr-only live regions announce the message (role="status" polite for
 * success/info, role="alert" for errors). Their text is cleared ~1s after the toast hides, and an
 * identical message shown again is re-announced. The visible toast lives in a "Notifications"
 * region.
 *
 * Position: bottom center of the viewport; with the app shell's sidebar/rail (≥ 768px) it is
 * centered over the main column instead (see the unscoped style block).
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { CircleAlert, CircleCheck, Info, X } from "lucide-vue-next";
import { useUIStore } from "@/stores/uiStore";
import type { ToastAction } from "@/components/ui/types";

type ToastKind = "success" | "error" | "info";

/** What this component needs from the store toast (`action` is optional / added later). */
interface ToastView {
  message: string;
  type: ToastKind;
  isVisible: boolean;
  action?: ToastAction | null;
}

const uiStore = useUIStore();
const toast = computed(() => uiStore.toast as typeof uiStore.toast & ToastView);

// Keep the last shown content so the leave transition does not flash an empty toast.
const shown = ref<{ message: string; type: ToastKind; action: ToastAction | null }>({
  message: "",
  type: "info",
  action: null,
});

// Screen-reader text lives in persistent live regions. It is (re)written when a toast shows and
// cleared shortly after the toast hides, so stale text never lingers in the DOM.
const ANNOUNCE_DELAY_MS = 60; // empty → text, so an identical message is announced again
const CLEAR_DELAY_MS = 1000; // after hide: long enough for the announcement to be queued

const politeText = ref("");
const alertText = ref("");
let announceTimer: number | undefined;
let clearTimer: number | undefined;

function clearTimers(): void {
  if (announceTimer !== undefined) window.clearTimeout(announceTimer);
  if (clearTimer !== undefined) window.clearTimeout(clearTimer);
  announceTimer = undefined;
  clearTimer = undefined;
}

function announce(message: string, type: ToastKind): void {
  clearTimers();
  politeText.value = "";
  alertText.value = "";
  announceTimer = window.setTimeout(() => {
    announceTimer = undefined;
    if (type === "error") alertText.value = message;
    else politeText.value = message;
  }, ANNOUNCE_DELAY_MS);
}

function scheduleClear(): void {
  if (clearTimer !== undefined) window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    clearTimer = undefined;
    politeText.value = "";
    alertText.value = "";
  }, ANNOUNCE_DELAY_MS + CLEAR_DELAY_MS);
}

// Pause the auto-hide countdown while the pointer is over the toast or focus is inside it
// (uiStore.pauseToast/resumeToast; optional so older stores keep working).
interface PausableToastStore {
  pauseToast?: () => void;
  resumeToast?: () => void;
}
function pause(): void {
  (uiStore as unknown as PausableToastStore).pauseToast?.();
}
function resume(): void {
  (uiStore as unknown as PausableToastStore).resumeToast?.();
}
let pointerInside = false;
let focusInside = false;
function onPointerEnter(): void {
  pointerInside = true;
  pause();
}
function onPointerLeave(): void {
  pointerInside = false;
  if (!focusInside) resume();
}
function onFocusIn(): void {
  focusInside = true;
  pause();
}
function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null;
  if (next && (event.currentTarget as HTMLElement).contains(next)) return;
  focusInside = false;
  if (!pointerInside) resume();
}

/**
 * Bumps on every showToast() call: the store restarts its auto-hide timer each time, so an
 * identical message shown again while visible is still re-announced. Read through a narrow view
 * so a renamed internal field only loses that re-announce, never breaks the toast.
 */
const showSignal = computed(() => (uiStore as unknown as { _timeoutId?: unknown })._timeoutId);

watch(
  () =>
    [toast.value.isVisible, toast.value.message, toast.value.type, toast.value.action, showSignal.value] as const,
  ([visible, message, type, action, signal], previous) => {
    if (!visible || !message) {
      if (previous?.[0]) scheduleClear();
      // The element is gone, so no pointerleave/focusout will arrive.
      pointerInside = false;
      focusInside = false;
      return;
    }
    shown.value = { message, type, action: action ?? null };
    // A new showToast() swaps one live timer id for another. Pause (id → null) and resume
    // (null → id) also touch it, but must not re-announce.
    const prevSignal = previous?.[4];
    const isNewShow =
      !previous ||
      !previous[0] ||
      previous[1] !== message ||
      previous[2] !== type ||
      (signal !== prevSignal && signal != null && prevSignal != null);
    if (isNewShow) announce(message, type);
  },
  { immediate: true },
);

onBeforeUnmount(clearTimers);

// Report the toast's rendered height (1–3 lines) so what stacks above it — the "Waking up the
// server…" pill — clears it exactly (uiStore.toastHeight; 0 while hidden).
const toastEl = ref<HTMLElement | null>(null);
let heightObserver: ResizeObserver | null = null;
watch(toastEl, (el) => {
  heightObserver?.disconnect();
  heightObserver = null;
  if (!el) {
    uiStore.setToastHeight(0);
    return;
  }
  uiStore.setToastHeight(el.offsetHeight);
  if (typeof ResizeObserver !== "undefined") {
    heightObserver = new ResizeObserver(() => uiStore.setToastHeight(el.offsetHeight));
    heightObserver.observe(el);
  }
});
onBeforeUnmount(() => {
  heightObserver?.disconnect();
  uiStore.setToastHeight(0);
});

const icon = computed(() => {
  switch (shown.value.type) {
    case "success":
      return CircleCheck;
    case "error":
      return CircleAlert;
    default:
      return Info;
  }
});

function runAction(): void {
  const action = shown.value.action;
  // Hide first: the action may show a follow-up toast that must not be hidden right away.
  uiStore.hideToast();
  action?.onClick();
}

function dismiss(): void {
  uiStore.hideToast();
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-region" role="region" aria-label="Notifications" data-overlay-ignore>
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ politeText }}</div>
      <div class="sr-only" role="alert" aria-atomic="true">{{ alertText }}</div>
      <Transition name="toast">
        <div
          v-if="toast.isVisible"
          ref="toastEl"
          class="toast"
          :class="`toast--${shown.type}`"
          @pointerenter="onPointerEnter"
          @pointerleave="onPointerLeave"
          @focusin="onFocusIn"
          @focusout="onFocusOut"
        >
          <component :is="icon" class="toast__icon" :size="16" />
          <p class="toast__message">{{ shown.message }}</p>
          <button v-if="shown.action" type="button" class="toast__action" @click="runAction">
            {{ shown.action.label }}
          </button>
          <button type="button" class="toast__close" aria-label="Dismiss notification" @click="dismiss">
            <X :size="16" />
          </button>
        </div>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-region {
  position: fixed;
  left: 50%;
  bottom: var(--toast-offset);
  z-index: var(--z-toast);
  width: min(440px, calc(100vw - 32px));
  transform: translateX(-50%);
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--space-2-5);
  width: 100%;
  padding: var(--space-2-5) var(--space-2) var(--space-2-5) 14px;
  border-radius: var(--radius-md);
  background-color: var(--toast-bg);
  color: var(--toast-text);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}

.toast__icon {
  flex-shrink: 0;
}
.toast--success .toast__icon {
  color: var(--toast-success);
}
.toast--error .toast__icon {
  color: var(--toast-danger);
}
.toast--info .toast__icon {
  color: var(--toast-info);
}

.toast__message {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  overflow-wrap: anywhere;
}

.toast__action,
.toast__close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  transition: background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.toast__action:hover,
.toast__close:hover {
  background-color: color-mix(in srgb, var(--toast-text) 10%, transparent);
}
/* The page focus ring is too faint on the inverse surface; use the toast accent (≥ 5.8:1). */
.toast__action:focus-visible,
.toast__close:focus-visible {
  outline-color: var(--toast-action);
  outline-offset: 0;
}

.toast__action {
  height: 28px;
  padding: 0 var(--space-2);
  color: var(--toast-action);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}

.toast__close {
  width: 28px;
  height: 28px;
  color: var(--toast-text-secondary);
}
.toast__close:hover {
  color: var(--toast-text);
}

@media (pointer: coarse) {
  .toast__action,
  .toast__close {
    min-width: 40px;
    height: 40px;
  }
}

.toast-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.toast-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in);
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.toast-leave-to {
  opacity: 0;
}

@media (forced-colors: active) {
  .toast {
    border: 1px solid CanvasText;
  }
}
</style>

<style>
/*
 * Center over the main column when the app shell shows a sidebar or rail (≥ 768px). Reads the
 * shell's mode class only (no shell edits); if those classes change, the toast simply falls back
 * to viewport centering. The sidebar column is --sidebar-w / --rail-w plus a 1px border.
 */
@media (min-width: 768px) {
  body:has(.app-shell--expanded) .toast-region {
    left: calc(50% + (var(--sidebar-w) + 1px) / 2);
  }
  body:has(.app-shell--rail) .toast-region {
    left: calc(50% + (var(--rail-w) + 1px) / 2);
  }
}
</style>
