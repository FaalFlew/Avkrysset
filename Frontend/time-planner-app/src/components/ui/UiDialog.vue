<script setup lang="ts">
/**
 * UiDialog — one primitive for modal dialog, bottom sheet and anchored popover-dialog.
 * Props:
 *   open: boolean (v-model:open) — required
 *   title: string — heading (also the accessible name, even when hidden)
 *   description?: string — under the title; wired to aria-describedby
 *   hideHeader?: boolean — no visual header; title/description stay as sr-only text
 *     (render your own header row in the default slot)
 *   size?: 'sm' (400) | 'md' (480) | 'lg' (640) — default 'md'
 *   presentation?: 'auto' | 'dialog' | 'sheet' — default 'auto' (= sheet below 768px)
 *   anchorRect?: AnchorRect | null — at ≥ 1024px with dialog presentation the panel is placed
 *     next to this rect (right, else left, else centered) over a transparent scrim
 *   role?: 'dialog' | 'alertdialog' (default 'dialog')
 *   dismissible?: boolean — Esc / scrim / X close it (default true)
 *   initialFocus?: string — selector inside the panel to focus first; otherwise
 *     [data-autofocus] → first text field → first focusable element
 *   showClose?: boolean — X button in the header (default true; needs dismissible)
 *   closeLabel?: string — X button label (default "Close")
 * Emits:
 *   update:open(false) — whenever the user dismisses it
 *   close(reason: 'escape' | 'outside' | 'button') — emitted right before update:open
 * Slots:
 *   default ({ close }) — scrolling body
 *   footer ({ close }) — sticky footer (flex row, right-aligned, gap 8; use margin-right:auto
 *     on an item to push it left)
 *   header-actions — extra controls left of the X button
 * Behaviour: teleported to <body>, aria-modal, focus trap (focus returns to the opener on
 * close), Esc via dialogStack (only the topmost overlay closes), scroll lock and `inert` #app
 * while open. Attrs (class, data-*, …) go to the panel element.
 * Exposes: panel (ref to the panel element), close(reason)
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { X } from "lucide-vue-next";
import UiIconButton from "./UiIconButton.vue";
import { isTopmost, register, unregister } from "./dialogStack";
import type { AnchorRect, OverlayCloseReason } from "./types";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { useBreakpoint } from "@/composables/useMediaQuery";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    description?: string;
    hideHeader?: boolean;
    size?: "sm" | "md" | "lg";
    presentation?: "auto" | "dialog" | "sheet";
    anchorRect?: AnchorRect | null;
    role?: "dialog" | "alertdialog";
    dismissible?: boolean;
    initialFocus?: string;
    showClose?: boolean;
    closeLabel?: string;
  }>(),
  {
    description: undefined,
    hideHeader: false,
    size: "md",
    presentation: "auto",
    anchorRect: null,
    role: "dialog",
    dismissible: true,
    initialFocus: undefined,
    showClose: true,
    closeLabel: "Close",
  },
);

const emit = defineEmits<{
  "update:open": [value: boolean];
  close: [reason: OverlayCloseReason];
}>();

const SIZES = { sm: 400, md: 480, lg: 640 } as const;
const ANCHOR_GAP = 8;
const VIEWPORT_MARGIN = 12;

const uid = useId();
const overlayId = `ui-dialog-${uid}`;
const titleId = `${overlayId}-title`;
const descId = `${overlayId}-desc`;

const panel = ref<HTMLElement | null>(null);
const panelHeight = ref(0);
const viewport = ref({ width: typeof window === "undefined" ? 0 : window.innerWidth, height: typeof window === "undefined" ? 0 : window.innerHeight });
const { isMobile, isDesktop, prefersReducedMotion } = useBreakpoint();

const trap = useFocusTrap(panel, { initialFocus: () => props.initialFocus });

const panelWidth = computed(() => Math.min(SIZES[props.size], viewport.value.width - 32));

const anchoredLeft = computed<number | null>(() => {
  const a = props.anchorRect;
  if (!a) return null;
  const w = panelWidth.value;
  const vw = viewport.value.width;
  if (a.right + ANCHOR_GAP + w <= vw - VIEWPORT_MARGIN) return a.right + ANCHOR_GAP;
  if (a.left - ANCHOR_GAP - w >= VIEWPORT_MARGIN) return a.left - ANCHOR_GAP - w;
  return null;
});

const layout = computed<"center" | "sheet" | "anchored">(() => {
  if (props.presentation === "sheet" || (props.presentation === "auto" && isMobile.value)) return "sheet";
  if (props.anchorRect && isDesktop.value && anchoredLeft.value !== null) return "anchored";
  return "center";
});

const panelStyle = computed<Record<string, string> | undefined>(() => {
  if (layout.value !== "anchored" || !props.anchorRect || anchoredLeft.value === null) return undefined;
  const vh = viewport.value.height;
  const h = panelHeight.value;
  const top = Math.min(Math.max(props.anchorRect.top, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vh - h - VIEWPORT_MARGIN));
  return { top: `${Math.round(top)}px`, left: `${Math.round(anchoredLeft.value)}px`, width: `${panelWidth.value}px` };
});

const transitionDuration = computed(() => {
  if (prefersReducedMotion.value) return 0;
  return layout.value === "anchored" ? { enter: 200, leave: 150 } : { enter: 250, leave: 150 };
});

function requestClose(reason: OverlayCloseReason): void {
  if (!props.open) return;
  if (!props.dismissible && reason !== "button") return;
  emit("close", reason);
  emit("update:open", false);
}

// Scrim: close only when both pointerdown and click happen on the scrim of the topmost overlay.
let pointerDownOnScrim = false;
function onScrimPointerDown(event: PointerEvent): void {
  pointerDownOnScrim = event.target === event.currentTarget && isTopmost(overlayId);
}
function onScrimClick(event: MouseEvent): void {
  const ok = pointerDownOnScrim && event.target === event.currentTarget && isTopmost(overlayId);
  pointerDownOnScrim = false;
  if (ok) requestClose("outside");
}

// Measure panel height (anchored placement) and viewport.
let resizeObserver: ResizeObserver | null = null;
function onWindowResize(): void {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
}
function startMeasuring(): void {
  onWindowResize();
  window.addEventListener("resize", onWindowResize);
  if (panel.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      panelHeight.value = panel.value?.offsetHeight ?? 0;
    });
    resizeObserver.observe(panel.value);
  }
  panelHeight.value = panel.value?.offsetHeight ?? 0;
}
function stopMeasuring(): void {
  window.removeEventListener("resize", onWindowResize);
  resizeObserver?.disconnect();
  resizeObserver = null;
}

let active = false;
async function setup(): Promise<void> {
  if (active) return;
  active = true;
  register(overlayId, requestClose, { modal: true, element: () => panel.value });
  await nextTick();
  if (!active) return;
  startMeasuring();
  trap.activate();
}

function teardown(): void {
  if (!active) return;
  active = false;
  stopMeasuring();
  unregister(overlayId); // removes `inert` first…
  trap.deactivate(); // …so focus can return to the opener
}

watch(
  () => props.open,
  (open) => {
    if (open) void setup();
    else teardown();
  },
  { immediate: true },
);

onBeforeUnmount(teardown);

defineExpose({ panel, close: requestClose });
</script>

<template>
  <Teleport to="body">
    <Transition :name="`ui-dlg-${layout}`" :duration="transitionDuration">
      <div v-if="open" class="ui-dialog" :class="`ui-dialog--${layout}`">
        <div class="ui-dialog__scrim" aria-hidden="true" @pointerdown="onScrimPointerDown" @click="onScrimClick" />
        <div
          ref="panel"
          v-bind="$attrs"
          class="ui-dialog__panel"
          :class="[`ui-dialog__panel--${size}`, { 'has-footer': !!$slots.footer }]"
          :style="panelStyle"
          :role="role"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="description ? descId : undefined"
          tabindex="-1"
        >
          <div v-if="layout === 'sheet'" class="ui-dialog__grabber" aria-hidden="true" />
          <header
            v-if="!hideHeader"
            class="ui-dialog__header"
            :class="{ 'ui-dialog__header--solo': !$slots.default }"
          >
            <div class="ui-dialog__heading">
              <h2 :id="titleId" class="ui-dialog__title">{{ title }}</h2>
              <p v-if="description" :id="descId" class="ui-dialog__description">{{ description }}</p>
            </div>
            <div v-if="$slots['header-actions'] || (showClose && dismissible)" class="ui-dialog__header-actions">
              <slot name="header-actions" />
              <UiIconButton
                v-if="showClose && dismissible"
                :label="closeLabel"
                size="sm"
                :tooltip="false"
                @click="requestClose('button')"
              >
                <X :size="16" />
              </UiIconButton>
            </div>
          </header>
          <template v-else>
            <h2 :id="titleId" class="sr-only">{{ title }}</h2>
            <p v-if="description" :id="descId" class="sr-only">{{ description }}</p>
          </template>
          <div
            v-if="$slots.default"
            class="ui-dialog__body"
            :class="{ 'ui-dialog__body--flush': hideHeader }"
          >
            <slot :close="requestClose" />
          </div>
          <footer v-if="$slots.footer" class="ui-dialog__footer">
            <slot name="footer" :close="requestClose" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ui-dialog {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.ui-dialog__scrim {
  position: absolute;
  inset: 0;
  background-color: var(--bg-scrim);
}
.ui-dialog--anchored .ui-dialog__scrim {
  background-color: transparent;
}

.ui-dialog__panel {
  --_w: 480px;
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(var(--_w), calc(100vw - 32px));
  min-height: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background-color: var(--bg-raised);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  outline: none;
}
.ui-dialog__panel--sm {
  --_w: 400px;
}
.ui-dialog__panel--lg {
  --_w: 640px;
}

/* ----- center ----- */
.ui-dialog--center .ui-dialog__panel {
  margin-top: 15vh;
  max-height: calc(100dvh - 15vh - var(--space-6));
}

/* ----- anchored ----- */
.ui-dialog--anchored .ui-dialog__panel {
  position: fixed;
  max-height: calc(100dvh - 24px);
}

/* ----- sheet ----- */
.ui-dialog--sheet {
  align-items: flex-end;
}
.ui-dialog--sheet .ui-dialog__panel {
  width: 100%;
  max-height: 90dvh;
  border-width: 1px 0 0;
  border-radius: var(--radius-xl) var(--radius-xl) 0 0;
}
.ui-dialog__grabber {
  flex-shrink: 0;
  width: 36px;
  height: 4px;
  margin: var(--space-2) auto 0;
  border-radius: var(--radius-full);
  background-color: var(--border-strong);
}
.ui-dialog--sheet .ui-dialog__body:last-child {
  padding-bottom: calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
}
.ui-dialog--sheet .ui-dialog__footer {
  padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
}

/* ----- parts ----- */
.ui-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  flex-shrink: 0;
  padding: var(--space-4) var(--space-5) var(--space-2);
}
.ui-dialog__header--solo {
  padding-bottom: var(--space-5);
}

.ui-dialog__heading {
  min-width: 0;
  padding-top: var(--space-1);
}

.ui-dialog__title {
  margin: 0;
  font-size: var(--fs-15);
  line-height: var(--lh-15);
  font-weight: var(--fw-semibold);
  letter-spacing: normal;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.ui-dialog__description {
  margin-top: var(--space-1);
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.ui-dialog__header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
  margin: 0 calc(var(--space-2) * -1) 0 0;
}

.ui-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-2) var(--space-5) var(--space-5);
}
.ui-dialog__body--flush {
  padding: var(--space-5);
}

.ui-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--space-2);
  flex-shrink: 0;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

/* ----- motion ----- */
/* center: fade + scale(.98 → 1) */
.ui-dlg-center-enter-active,
.ui-dlg-center-enter-active .ui-dialog__panel {
  transition: opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out);
}
.ui-dlg-center-leave-active,
.ui-dlg-center-leave-active .ui-dialog__panel {
  transition: opacity var(--dur-fast) var(--ease-in), transform var(--dur-fast) var(--ease-in);
}
.ui-dlg-center-enter-from,
.ui-dlg-center-leave-to {
  opacity: 0;
}
.ui-dlg-center-enter-from .ui-dialog__panel,
.ui-dlg-center-leave-to .ui-dialog__panel {
  transform: scale(0.98);
}

/* sheet: scrim fades, panel slides up */
.ui-dlg-sheet-enter-active .ui-dialog__scrim,
.ui-dlg-sheet-enter-active .ui-dialog__panel {
  transition: opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out);
}
.ui-dlg-sheet-leave-active .ui-dialog__scrim,
.ui-dlg-sheet-leave-active .ui-dialog__panel {
  transition: opacity var(--dur-fast) var(--ease-in), transform var(--dur-fast) var(--ease-in);
}
.ui-dlg-sheet-enter-from .ui-dialog__scrim,
.ui-dlg-sheet-leave-to .ui-dialog__scrim {
  opacity: 0;
}
.ui-dlg-sheet-enter-from .ui-dialog__panel,
.ui-dlg-sheet-leave-to .ui-dialog__panel {
  transform: translateY(100%);
}

/* anchored: fade + 4px rise */
.ui-dlg-anchored-enter-active .ui-dialog__panel {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.ui-dlg-anchored-leave-active .ui-dialog__panel {
  transition: opacity var(--dur-fast) var(--ease-in), transform var(--dur-fast) var(--ease-in);
}
.ui-dlg-anchored-enter-from .ui-dialog__panel,
.ui-dlg-anchored-leave-to .ui-dialog__panel {
  opacity: 0;
  transform: translateY(4px);
}

@media (forced-colors: active) {
  .ui-dialog__panel {
    border: 1px solid CanvasText;
  }
}
</style>
