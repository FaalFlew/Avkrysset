<script setup lang="ts">
/**
 * TaskBlock — one task on the planner grid (absolutely positioned inside its day column).
 * Variants:
 *   'task'        focusable <button>: Enter/Space edit, arrows move (handled by the parent via @keydown)
 *   'ghost'       live drag preview (shadow, above other blocks)
 *   'placeholder' where the dragged task came from (dashed outline)
 *   'anchor'      the dragged task's own node, kept mounted (invisible) while the view shows
 *                 another week, so a touch drag keeps its target element
 *   'draft'       the task being created in the editor (accent, dashed)
 * 'task', 'placeholder' and 'anchor' render the same <button>, so starting a drag never replaces
 * the node the pointer/touch sequence is attached to.
 * Colors: tinted category background + 3px inset category marker; text uses --block-text /
 * --block-meta (never white on the category color).
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { Task } from "@/types";
import { formatTime } from "@/lib/datetime";
import { blockColors, blockTint, blockTintHover, isHex } from "@/lib/color";
import { displayTitle, formatEndDayMarker, formatTaskLabel, formatTaskTimeRange } from "@/lib/plannerFormat";
import { useTheme } from "@/composables/useTheme";
import { blockExtent, laneStyle, type LanePlacement } from "./laneLayout";
import { orgMonogram } from "@/lib/taskAccess";
import { attachTouchScrollGuard, type DragMode } from "@/composables/useTaskDragAndDrop";

const props = withDefaults(
  defineProps<{
    task: Pick<Task, "id" | "title" | "start" | "duration">;
    color: string;
    categoryName?: string;
    variant?: "task" | "ghost" | "placeholder" | "anchor" | "draft";
    /** Day column width in px (content density). */
    columnWidth?: number;
    saving?: boolean;
    conflict?: boolean;
    fresh?: boolean;
    /** Show hover resize handles (fine pointers only). */
    resizable?: boolean;
    /** id of the sr-only keyboard hint. */
    hintId?: string;
    /** Side-by-side lane when it overlaps other blocks (see laneLayout.ts). */
    placement?: LanePlacement;
    /** Org task assigned to me by an admin: no drag/resize handles (Q1). */
    readOnly?: boolean;
    /** Organization of an org task (badge + "…, Acme task" in the label). */
    orgName?: string | null;
  }>(),
  {
    categoryName: undefined,
    variant: "task",
    columnWidth: 140,
    saving: false,
    conflict: false,
    fresh: false,
    resizable: false,
    hintId: undefined,
    placement: undefined,
    readOnly: false,
    orgName: null,
  }
);

const emit = defineEmits<{
  press: [event: PointerEvent, mode: DragMode];
  activate: [event: MouseEvent];
  keydown: [event: KeyboardEvent];
}>();

const { resolvedTheme } = useTheme();

const geometry = computed(() => blockExtent(props.task.start, props.task.duration));
/** Width this block actually gets (laned blocks share the column). */
const effectiveWidth = computed(() => {
  const p = props.placement;
  return p && p.lanes > 1 ? (props.columnWidth * p.span) / p.lanes : props.columnWidth;
});

// Content is chosen by the height actually available, so no line is ever cut mid-glyph:
// padding 4+4, title line 18px (--lh-13), meta lines 16px (--lh-12).
const PADDING_Y = 8;
const TITLE_LINE = 18;
const META_LINE = 16;

interface BlockLayout {
  /** One line "Title · 09:00" (blocks < 42px), or stacked lines. */
  kind: "line" | "stack";
  /** Line blocks under 22px use the 11px micro size. */
  micro: boolean;
  titleLines: 1 | 2;
  showTime: boolean;
  /** Start time only ("09:00") instead of the range, where the range would not fit. */
  compactTime: boolean;
  showCategory: boolean;
}

const layout = computed<BlockLayout>(() => {
  const h = geometry.value.height;
  const inner = h - PADDING_Y;
  if (inner < TITLE_LINE + META_LINE) {
    return { kind: "line", micro: h < 22, titleLines: 1, showTime: false, compactTime: false, showCategory: false };
  }
  const titleLines: 1 | 2 = inner >= 2 * TITLE_LINE + 2 * META_LINE ? 2 : 1;
  let rest = inner - titleLines * TITLE_LINE;
  // Time beats category in a calendar. Narrow columns (< 96px) show just the start time on
  // short blocks, where the full range would be truncated.
  const showTime = rest >= META_LINE;
  const compactTime = effectiveWidth.value < 96 && h < 52;
  if (showTime) rest -= META_LINE;
  const showCategory = !!props.categoryName && props.variant !== "draft" && rest >= META_LINE;
  return { kind: "stack", micro: false, titleLines, showTime, compactTime, showCategory };
});

// Whitespace-only titles (legacy data) fall back instead of rendering blank.
const title = computed(() => displayTitle(props.task.title, props.variant === "draft" ? "New task" : "Untitled task"));
/** "08:00 – 14:00 +1d" when the task runs into a later day (e.g. legacy 30h tasks). */
const timeRange = computed(() => formatTaskTimeRange(props.task.start, props.task.duration));
const endDayMarker = computed(() => formatEndDayMarker(props.task.start, props.task.duration));
const startTime = computed(() =>
  endDayMarker.value ? `${formatTime(props.task.start)} ${endDayMarker.value}` : formatTime(props.task.start)
);
const ariaLabel = computed(() => formatTaskLabel(props.task, props.categoryName, props.orgName));
/** Full text as a native tooltip (titles are truncated in short/narrow blocks). */
const tooltip = computed(() =>
  [title.value, timeRange.value, props.categoryName, props.orgName].filter(Boolean).join(" · ")
);
const monogram = computed(() => (props.orgName ? orgMonogram(props.orgName) : ""));

// Category colors are adjusted per theme so the marker/handles/outline stay ≥ 3:1 against the
// grid and the tinted fill keeps text ≥ 4.5:1 (very dark/pale custom colors). Non-hex values
// (the draft's `var(--accent)`) are used as-is.
const blockPalette = computed(() =>
  isHex(props.color) ? blockColors(props.color, resolvedTheme.value) : null
);

const style = computed(() => ({
  top: `${geometry.value.top}px`,
  height: `${geometry.value.height}px`,
  ...laneStyle(props.placement),
  "--cat": blockPalette.value?.color ?? props.color,
  "--_tint": blockPalette.value?.tint ?? blockTint(props.color, resolvedTheme.value),
  "--_tint-hover": blockPalette.value?.tintHover ?? blockTintHover(props.color, resolvedTheme.value),
}));

const classes = computed(() => [
  "task-block",
  `task-block--${props.variant}`,
  `task-block--${layout.value.kind}`,
  {
    "task-block--micro": layout.value.micro,
    "task-block--two-line-title": layout.value.titleLines === 2,
    "is-clamped": geometry.value.clamped,
    "is-saving": props.saving,
    "is-conflict": props.conflict,
    "is-fresh": props.fresh,
    "is-readonly": props.readOnly,
    "is-laned": !!props.placement && props.placement.lanes > 1,
  },
]);

const canResizeTop = computed(() => props.resizable && geometry.value.height >= 28);

let lastPointerType = "";
function onPointerDown(event: PointerEvent): void {
  lastPointerType = event.pointerType;
  emit("press", event, "move");
}
/** A long-press on touch starts a drag; don't let it open the context menu as well. */
function onContextMenu(event: MouseEvent): void {
  if (lastPointerType === "touch") event.preventDefault();
}
function onHandleDown(event: PointerEvent, mode: DragMode): void {
  emit("press", event, mode);
}

// Non-passive touchmove guard registered as soon as the root element exists (i.e. before any
// touchstart on it), so a long-pressed touch drag can block native scrolling in every direction.
// It only calls preventDefault() while this block is the active touch-drag target. The root of
// the task/placeholder/anchor variants is the same <button>, so the guard survives the drag and
// the cross-day navigation that keeps the origin node mounted.
const rootEl = ref<HTMLElement | null>(null);
let detachGuard: (() => void) | null = null;
watch(
  rootEl,
  (el) => {
    detachGuard?.();
    detachGuard = el ? attachTouchScrollGuard(el) : null;
  },
  { flush: "post" }
);
onBeforeUnmount(() => detachGuard?.());
</script>

<template>
  <button
    ref="rootEl"
    v-if="variant === 'task' || variant === 'placeholder' || variant === 'anchor'"
    type="button"
    :class="classes"
    :style="style"
    :data-task-id="task.id"
    :aria-label="ariaLabel"
    :aria-describedby="hintId"
    :aria-busy="saving || undefined"
    :aria-hidden="variant === 'anchor' || undefined"
    :tabindex="variant === 'anchor' ? -1 : undefined"
    :title="tooltip"
    @pointerdown="onPointerDown"
    @click="emit('activate', $event)"
    @keydown="emit('keydown', $event)"
    @contextmenu="onContextMenu"
  >
    <span v-if="resizable && canResizeTop" class="task-block__handle task-block__handle--top" aria-hidden="true" @pointerdown.stop="onHandleDown($event, 'top')" />
    <span class="task-block__body" aria-hidden="true">
      <template v-if="layout.kind === 'line'">
        <span class="task-block__line"><span v-if="monogram" class="task-block__org">{{ monogram }}</span>{{ title }}<span class="task-block__meta-inline"> · {{ startTime }}</span></span>
      </template>
      <template v-else>
        <span class="task-block__title"><span v-if="monogram" class="task-block__org">{{ monogram }}</span>{{ title }}</span>
        <span v-if="layout.showTime" class="task-block__time tabular">{{ layout.compactTime ? startTime : timeRange }}</span>
        <span v-if="layout.showCategory" class="task-block__category">{{ categoryName }}</span>
      </template>
      <span v-if="conflict" class="task-block__conflict">Overlaps</span>
    </span>
    <span v-if="resizable" class="task-block__handle task-block__handle--bottom" aria-hidden="true" @pointerdown.stop="onHandleDown($event, 'bottom')" />
  </button>
  <div v-else ref="rootEl" :class="classes" :style="style" aria-hidden="true">
    <span class="task-block__body">
      <template v-if="layout.kind === 'line'">
        <span class="task-block__line"><span v-if="monogram" class="task-block__org">{{ monogram }}</span>{{ title }}<span class="task-block__meta-inline"> · {{ startTime }}</span></span>
      </template>
      <template v-else>
        <span class="task-block__title"><span v-if="monogram" class="task-block__org">{{ monogram }}</span>{{ title }}</span>
        <span v-if="layout.showTime" class="task-block__time tabular">{{ layout.compactTime ? startTime : timeRange }}</span>
        <span v-if="layout.showCategory" class="task-block__category">{{ categoryName }}</span>
      </template>
      <span v-if="conflict" class="task-block__conflict">Overlaps</span>
    </span>
  </div>
</template>

<style scoped>
.task-block {
  position: absolute;
  left: 2px;
  right: 6px;
  z-index: var(--z-grid-task);
  display: block;
  min-width: 0;
  padding: 4px 8px 4px 11px;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-sm);
  background-color: color-mix(in srgb, var(--cat) var(--_tint), var(--grid-bg));
  box-shadow: inset 3px 0 0 var(--cat);
  color: var(--block-text);
  text-align: left;
  font: inherit;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: pan-y pinch-zoom;
  transition: background-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard),
    opacity var(--dur-fast) var(--ease-standard);
}
.task-block:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
  z-index: var(--z-grid-drag);
}
.task-block.is-clamped {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

@media (hover: hover) and (pointer: fine) {
  .task-block--task:hover {
    background-color: color-mix(in srgb, var(--cat) var(--_tint-hover), var(--grid-bg));
    box-shadow: inset 3px 0 0 var(--cat), var(--shadow-xs);
  }
  .task-block--task:hover .task-block__handle::after {
    opacity: 1;
  }
}

.task-block__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

/* Every line keeps its full line height (flex-shrink: 0); which lines render is decided in the
   script from the block height, so nothing is ever clipped mid-glyph. */
.task-block__line,
.task-block__title,
.task-block__time,
.task-block__category {
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Single line ("Title · 09:00") for blocks under 42px, vertically centered. */
.task-block--line {
  padding-top: 0;
  padding-bottom: 0;
}
.task-block--line .task-block__body {
  justify-content: center;
}
.task-block__line {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  font-weight: var(--fw-semibold);
}
.task-block--micro .task-block__line {
  font-size: var(--fs-11);
  line-height: 12px;
}
/* Org badge (monogram) before the title of org tasks. */
.task-block__org {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  margin-right: 4px;
  padding: 0 2px;
  border-radius: 3px;
  background-color: color-mix(in srgb, var(--block-text) 12%, transparent);
  color: var(--block-text);
  font-size: 9px;
  line-height: 1;
  font-weight: var(--fw-semibold);
  vertical-align: 1px;
}
/* Read-only org tasks open a view on click but can't be moved: no "grab me" pointer. */
.task-block.is-readonly {
  cursor: default;
}
.task-block--micro .task-block__org {
  min-width: 12px;
  height: 11px;
  font-size: 8px;
}
.task-block__meta-inline {
  font-weight: var(--fw-regular);
  color: var(--block-meta);
  font-variant-numeric: tabular-nums;
}

.task-block__title {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-semibold);
}
.task-block--two-line-title .task-block__title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  max-height: calc(2 * var(--lh-13));
  white-space: normal;
  overflow-wrap: anywhere;
}
.task-block__time,
.task-block__category {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--block-meta);
}
.task-block__conflict {
  position: absolute;
  right: 4px;
  bottom: 2px;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background-color: var(--bg-raised);
  color: var(--danger-text);
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-semibold);
}

/* Resize handles: 8px hit areas, 24×3 bars that appear on hover (fine pointers only). */
.task-block__handle {
  position: absolute;
  left: 0;
  right: 0;
  height: 8px;
  z-index: 1;
  cursor: ns-resize;
}
.task-block__handle--top {
  top: 0;
}
.task-block__handle--bottom {
  bottom: 0;
}
.task-block__handle::after {
  content: "";
  position: absolute;
  left: 50%;
  width: 24px;
  height: 3px;
  margin-left: -12px;
  border-radius: var(--radius-full);
  background-color: var(--cat);
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-standard);
}
.task-block__handle--top::after {
  top: 2px;
}
.task-block__handle--bottom::after {
  bottom: 2px;
}
@media (hover: none), (pointer: coarse) {
  .task-block__handle {
    display: none;
  }
}

/* ----- states ----- */
.task-block--ghost {
  z-index: var(--z-grid-drag);
  box-shadow: inset 3px 0 0 var(--cat), var(--shadow-md);
  cursor: grabbing;
  pointer-events: none;
}
.task-block--placeholder {
  background: none;
  box-shadow: none;
  outline: 1px dashed var(--cat);
  outline-offset: -1px;
  opacity: 0.7;
  pointer-events: none;
}
/* The dragged task's own node while another week is shown: kept mounted, never seen. */
.task-block--anchor {
  visibility: hidden;
  pointer-events: none;
}
.task-block--placeholder .task-block__body {
  visibility: hidden;
}
.task-block--draft {
  z-index: var(--z-grid-drag);
  background-color: var(--accent-subtle);
  box-shadow: none;
  outline: 1px dashed var(--accent);
  outline-offset: -1px;
  color: var(--accent-text);
  pointer-events: none;
}
.task-block--draft .task-block__time,
.task-block--draft .task-block__meta-inline {
  color: var(--accent-text);
}
.task-block.is-conflict {
  box-shadow: inset 3px 0 0 var(--cat), 0 0 0 1.5px var(--danger), var(--shadow-md);
}
.task-block.is-saving {
  opacity: 0.85;
  cursor: progress;
}
.task-block.is-fresh {
  animation: task-block-fresh 600ms var(--ease-out) both;
}
@keyframes task-block-fresh {
  from {
    box-shadow: inset 3px 0 0 var(--cat), 0 0 0 1px var(--accent);
  }
  to {
    box-shadow: inset 3px 0 0 var(--cat), 0 0 0 1px transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  .task-block.is-fresh {
    animation: none;
  }
}

@media (forced-colors: active) {
  .task-block {
    border: 1px solid CanvasText;
  }
  .task-block:focus-visible {
    outline-color: Highlight;
  }
}
</style>
