<script setup lang="ts">
/**
 * UiPopover — non-modal floating panel anchored to a trigger (below 768px: a UiDialog sheet).
 * Props:
 *   open?: boolean (v-model:open; works uncontrolled too)
 *   placement?: 'bottom-start' | 'bottom-end' (default 'bottom-start'; flips above when needed)
 *   ariaLabel: string — accessible name of the panel (also the sheet title on mobile)
 *   padding?: 'none' | 'sm' (8) | 'md' (12) — default 'md'
 *   sheetOnMobile?: boolean — default true
 * Slots:
 *   trigger ({ open, toggle, close, triggerProps }) — render your button and spread
 *     `v-bind="triggerProps"` on it (aria-haspopup, aria-expanded, aria-controls) and call toggle.
 *   default ({ close }) — panel content
 * Behaviour: on open, focus moves into the panel ([data-autofocus] → first focusable → panel).
 * Esc or outside pointerdown closes and returns focus to the trigger; focus leaving the panel
 * closes it. Tab past the last element closes it and continues after the trigger; Shift+Tab
 * from the first element returns to the trigger. Registers with dialogStack (no scroll lock,
 * no inert). Content is teleported to <body>.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import UiDialog from "./UiDialog.vue";
import { useFloating } from "./floating";
import { hasOpenModal, isInsideOverlayAbove, register, unregister } from "./dialogStack";
import type { OverlayCloseReason } from "./types";
import { focusInitial, getFocusableElements } from "@/composables/useFocusTrap";
import { useBreakpoint } from "@/composables/useMediaQuery";

const props = withDefaults(
  defineProps<{
    placement?: "bottom-start" | "bottom-end";
    ariaLabel: string;
    padding?: "none" | "sm" | "md";
    sheetOnMobile?: boolean;
  }>(),
  { placement: "bottom-start", padding: "md", sheetOnMobile: true },
);

const open = defineModel<boolean>("open", { default: false });

const uid = useId();
const overlayId = `ui-popover-${uid}`;
const contentId = `${overlayId}-content`;
const anchorRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const zIndex = ref("var(--z-popover)");
const { isMobile } = useBreakpoint();

const asSheet = computed(() => props.sheetOnMobile && isMobile.value);

function triggerEl(): HTMLElement | null {
  return (anchorRef.value?.firstElementChild as HTMLElement | null) ?? null;
}

const { style: floatingStyle } = useFloating(triggerEl, contentRef, {
  placement: () => props.placement,
  isOpen: () => open.value && !asSheet.value,
  offset: 6,
});

const triggerProps = computed(() => ({
  "aria-haspopup": "dialog" as const,
  "aria-expanded": open.value,
  "aria-controls": open.value && !asSheet.value ? contentId : undefined,
}));

function focusTrigger(): void {
  triggerEl()?.focus({ preventScroll: true });
}

function close(returnFocus = true): void {
  if (!open.value) return;
  open.value = false;
  if (returnFocus) focusTrigger();
}

function toggle(): void {
  if (open.value) close();
  else open.value = true;
}

function onStackClose(reason: OverlayCloseReason): void {
  close(reason === "escape" || reason === "outside");
}

// ----- desktop popover lifecycle (the mobile sheet is a UiDialog with its own lifecycle)
let registered = false;
watch(
  () => open.value && !asSheet.value,
  async (isOpen) => {
    if (isOpen) {
      zIndex.value = hasOpenModal.value ? "calc(var(--z-modal) + 1)" : "var(--z-popover)";
      register(overlayId, onStackClose, {
        element: () => contentRef.value,
        ignore: () => [anchorRef.value],
      });
      registered = true;
      await nextTick();
      if (contentRef.value && !contentRef.value.contains(document.activeElement)) {
        focusInitial(contentRef.value);
      }
    } else if (registered) {
      registered = false;
      unregister(overlayId);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (registered) unregister(overlayId);
});

function onContentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Tab" || !contentRef.value) return;
  const focusables = getFocusableElements(contentRef.value);
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === contentRef.value || !first)) {
    event.preventDefault();
    close(true);
  } else if (!event.shiftKey && (active === last || !last)) {
    // Focus the trigger without preventing default: the browser then moves on to the
    // element after the trigger, as if the panel were inline.
    close(true);
  }
}

function onContentFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null;
  if (!next) return; // window blur or click on nothing focusable (outside pointerdown handles that)
  if (contentRef.value?.contains(next) || anchorRef.value?.contains(next)) return;
  if (isInsideOverlayAbove(overlayId, next)) return;
  close(false);
}

// Sheet (mobile) closes through UiDialog.
function onSheetOpenChange(value: boolean): void {
  open.value = value;
}

defineExpose({ close, toggle });
</script>

<template>
  <span ref="anchorRef" class="ui-popover-anchor">
    <slot name="trigger" :open="open" :toggle="toggle" :close="close" :triggerProps="triggerProps" />
  </span>
  <Teleport to="body">
    <Transition name="ui-pop">
      <div
        v-if="open && !asSheet"
        :id="contentId"
        ref="contentRef"
        class="ui-popover"
        :class="`ui-popover--pad-${padding}`"
        role="dialog"
        :aria-label="ariaLabel"
        tabindex="-1"
        data-ui-floating
        :style="{ ...floatingStyle, zIndex }"
        @keydown="onContentKeydown"
        @focusout="onContentFocusOut"
      >
        <slot :close="close" />
      </div>
    </Transition>
  </Teleport>
  <UiDialog
    v-if="asSheet"
    :open="open"
    :title="ariaLabel"
    presentation="sheet"
    @update:open="onSheetOpenChange"
  >
    <slot :close="close" />
  </UiDialog>
</template>

<style scoped>
.ui-popover-anchor {
  display: contents;
}

.ui-popover {
  min-width: 180px;
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background-color: var(--bg-raised);
  color: var(--text-primary);
  box-shadow: var(--shadow-md);
  outline: none;
}
.ui-popover--pad-sm {
  padding: var(--space-2);
}
.ui-popover--pad-md {
  padding: var(--space-3);
}

.ui-pop-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.ui-pop-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in);
}
.ui-pop-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.ui-pop-leave-to {
  opacity: 0;
}

@media (forced-colors: active) {
  .ui-popover {
    border-color: CanvasText;
  }
}
</style>
