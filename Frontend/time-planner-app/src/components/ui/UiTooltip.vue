<script setup lang="ts">
/**
 * UiTooltip — hover/focus hint.
 * Props:
 *   text: string
 *   shortcut?: string[] — rendered as <UiKbd tone="inverse"> after the text
 *   placement?: 'top' | 'bottom' | 'left' | 'right' (default 'top', flips when there is no room)
 *   disabled?: boolean
 *   target?: HTMLElement | null — "attached" mode: describe this element instead of the slot.
 *     Used by UiIconButton (renders <UiTooltip :target="buttonEl"> inside the button) so the
 *     button stays the component root.
 * Slots:
 *   default — "wrap" mode trigger (one focusable element). The wrapper is `display: contents`.
 * Behaviour: shows after 500ms hover (instantly if another tooltip closed < 300ms ago) and
 * immediately on keyboard focus (:focus-visible). Hides on Esc, blur, pointerleave and
 * pointerdown. Never shows for touch / coarse pointers. The trigger gets aria-describedby
 * pointing at hidden text unless the text equals its aria-label (then nothing is added).
 */
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import UiKbd from "./UiKbd.vue";
import { useFloating } from "./floating";
import { useBreakpoint } from "@/composables/useMediaQuery";

const props = withDefaults(
  defineProps<{
    text: string;
    shortcut?: string[];
    placement?: "top" | "bottom" | "left" | "right";
    disabled?: boolean;
    target?: HTMLElement | null;
  }>(),
  { shortcut: undefined, placement: "top", disabled: false, target: undefined },
);

const SHOW_DELAY = 500;
const SKIP_DELAY_WINDOW = 300;

const descId = `ui-tooltip-${useId()}`;
const wrapperRef = ref<HTMLElement | null>(null);
const tooltipRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const { isCoarse } = useBreakpoint();
let showTimer: number | undefined;

const attached = computed(() => props.target !== undefined);

function triggerEl(): HTMLElement | null {
  if (attached.value) return props.target ?? null;
  return (wrapperRef.value?.firstElementChild as HTMLElement | null) ?? null;
}

function containsNode(node: Node | null): boolean {
  if (!node) return false;
  if (attached.value) return !!props.target?.contains(node);
  return !!wrapperRef.value?.contains(node);
}

const { style: floatingStyle } = useFloating(triggerEl, tooltipRef, {
  placement: () => props.placement,
  isOpen: () => visible.value,
  offset: 6,
});

const canShow = computed(() => !props.disabled && !!props.text && !isCoarse.value);

function clearTimer(): void {
  if (showTimer !== undefined) {
    window.clearTimeout(showTimer);
    showTimer = undefined;
  }
}

function show(immediate = false): void {
  if (!canShow.value) return;
  clearTimer();
  const delay = immediate || performance.now() - lastHiddenAt < SKIP_DELAY_WINDOW ? 0 : SHOW_DELAY;
  if (delay === 0) {
    visible.value = true;
  } else {
    showTimer = window.setTimeout(() => {
      visible.value = true;
    }, delay);
  }
}

function hide(): void {
  clearTimer();
  if (visible.value) {
    visible.value = false;
    lastHiddenAt = performance.now();
  }
}

function onPointerOver(event: PointerEvent): void {
  if (event.pointerType === "touch") return;
  if (containsNode(event.relatedTarget as Node | null)) return;
  show();
}

function onPointerOut(event: PointerEvent): void {
  if (containsNode(event.relatedTarget as Node | null)) return;
  hide();
}

function onFocusIn(event: FocusEvent): void {
  const target = event.target as HTMLElement | null;
  let focusVisible = false;
  try {
    focusVisible = !!target?.matches(":focus-visible");
  } catch {
    focusVisible = false;
  }
  if (focusVisible) show(true);
}

function onFocusOut(event: FocusEvent): void {
  if (containsNode(event.relatedTarget as Node | null)) return;
  hide();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") hide();
}

watch(visible, (isVisible) => {
  if (isVisible) document.addEventListener("keydown", onDocumentKeydown, true);
  else document.removeEventListener("keydown", onDocumentKeydown, true);
});

watch(canShow, (ok) => {
  if (!ok) hide();
});

// --- attached mode: listen on the target element directly
function bind(el: HTMLElement): void {
  el.addEventListener("pointerover", onPointerOver);
  el.addEventListener("pointerout", onPointerOut);
  el.addEventListener("pointerdown", hide);
  el.addEventListener("focusin", onFocusIn);
  el.addEventListener("focusout", onFocusOut);
}
function unbind(el: HTMLElement): void {
  el.removeEventListener("pointerover", onPointerOver);
  el.removeEventListener("pointerout", onPointerOut);
  el.removeEventListener("pointerdown", hide);
  el.removeEventListener("focusin", onFocusIn);
  el.removeEventListener("focusout", onFocusOut);
}
watch(
  () => props.target,
  (el, prev) => {
    if (prev) unbind(prev);
    if (el) bind(el);
    syncDescribedBy();
  },
  { flush: "post" },
);

// --- aria-describedby wiring on the trigger element
function syncDescribedBy(): void {
  const el = triggerEl();
  if (!el) return;
  const tokens = (el.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t !== descId);
  const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().toLowerCase();
  const duplicates = name === props.text.trim().toLowerCase();
  if (props.text && !duplicates && !props.disabled) tokens.push(descId);
  if (tokens.length) el.setAttribute("aria-describedby", tokens.join(" "));
  else el.removeAttribute("aria-describedby");
}

onMounted(() => {
  if (attached.value && props.target) bind(props.target);
  syncDescribedBy();
});
watch(() => [props.text, props.disabled], syncDescribedBy, { flush: "post" });

onBeforeUnmount(() => {
  clearTimer();
  if (props.target) unbind(props.target);
  document.removeEventListener("keydown", onDocumentKeydown, true);
});
</script>

<script lang="ts">
// Shared between all tooltip instances: lets a second tooltip show instantly right after one closes.
let lastHiddenAt = -Infinity;
</script>

<template>
  <span
    v-if="!attached"
    ref="wrapperRef"
    class="ui-tooltip-trigger"
    @pointerover="onPointerOver"
    @pointerout="onPointerOut"
    @pointerdown="hide"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <slot />
    <span :id="descId" hidden>{{ text }}</span>
    <Teleport to="body">
      <Transition name="ui-tooltip">
        <div
          v-if="visible"
          ref="tooltipRef"
          class="ui-tooltip"
          role="tooltip"
          aria-hidden="true"
          data-overlay-ignore
          :style="floatingStyle"
        >
          <span>{{ text }}</span>
          <UiKbd v-if="shortcut?.length" :keys="shortcut" tone="inverse" />
        </div>
      </Transition>
    </Teleport>
  </span>
  <span v-else class="ui-tooltip-anchor" hidden>
    <span :id="descId">{{ text }}</span>
    <Teleport to="body">
      <Transition name="ui-tooltip">
        <div
          v-if="visible"
          ref="tooltipRef"
          class="ui-tooltip"
          role="tooltip"
          aria-hidden="true"
          data-overlay-ignore
          :style="floatingStyle"
        >
          <span>{{ text }}</span>
          <UiKbd v-if="shortcut?.length" :keys="shortcut" tone="inverse" />
        </div>
      </Transition>
    </Teleport>
  </span>
</template>

<style scoped>
.ui-tooltip-trigger {
  display: contents;
}

.ui-tooltip {
  z-index: var(--z-tooltip);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  max-width: 260px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background-color: var(--bg-inverse);
  color: var(--text-inverse);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  font-weight: var(--fw-medium);
  letter-spacing: normal;
  text-transform: none;
  pointer-events: none;
  box-shadow: var(--shadow-md);
  white-space: normal;
}

.ui-tooltip-enter-active {
  transition: opacity var(--dur-fast) var(--ease-out);
}
.ui-tooltip-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in);
}
.ui-tooltip-enter-from,
.ui-tooltip-leave-to {
  opacity: 0;
}

@media (forced-colors: active) {
  .ui-tooltip {
    border: 1px solid CanvasText;
  }
}
</style>
