<script setup lang="ts" generic="T extends string | number">
/**
 * UiSegmentedControl — single-choice segmented control (radiogroup with a sliding thumb).
 * Generic over the value type T.
 * Props:
 *   modelValue: T (v-model)
 *   options: SegmentOption<T>[] — { value, label, icon?, ariaLabel? }
 *   ariaLabel: string — accessible name of the group (required)
 *   size?: 'sm' | 'md' (default 'md')
 *   block?: boolean — stretch to the container width
 *   iconOnly?: boolean — show icons only; labels become aria-labels + tooltips
 * Emits: update:modelValue(value: T)
 * Keyboard: roving tabindex; ←/→ and ↑/↓ move and select (wrapping); Home/End.
 */
import { computed } from "vue";
import UiTooltip from "./UiTooltip.vue";
import type { SegmentOption } from "./types";

const props = withDefaults(
  defineProps<{
    modelValue: T;
    options: SegmentOption<T>[];
    ariaLabel: string;
    size?: "sm" | "md";
    block?: boolean;
    iconOnly?: boolean;
  }>(),
  { size: "md", block: false, iconOnly: false },
);

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const itemRefs: (HTMLButtonElement | null)[] = [];
function setItemRef(el: unknown, index: number): void {
  itemRefs[index] = el instanceof HTMLButtonElement ? el : null;
}
const selectedIndex = computed(() => props.options.findIndex((o) => o.value === props.modelValue));
const tabStop = computed(() => (selectedIndex.value === -1 ? 0 : selectedIndex.value));

const thumbStyle = computed(() => ({
  width: `calc((100% - 4px) / ${Math.max(props.options.length, 1)})`,
  transform: `translateX(${selectedIndex.value * 100}%)`,
}));

function select(index: number): void {
  const option = props.options[index];
  if (!option) return;
  if (option.value !== props.modelValue) emit("update:modelValue", option.value);
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const count = props.options.length;
  if (count === 0) return;
  let next: number;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      next = (index + 1) % count;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      next = (index - 1 + count) % count;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  event.stopPropagation();
  select(next);
  itemRefs[next]?.focus();
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-label="ariaLabel"
    class="ui-seg"
    :class="[`ui-seg--${size}`, { 'ui-seg--block': block, 'ui-seg--icon-only': iconOnly }]"
    :style="{ '--_count': options.length }"
  >
    <span v-if="selectedIndex !== -1" class="ui-seg__thumb" :style="thumbStyle" aria-hidden="true" />
    <template v-for="(option, index) in options" :key="String(option.value)">
      <UiTooltip v-if="iconOnly" :text="option.ariaLabel ?? option.label" placement="top">
        <button
          :ref="(el) => setItemRef(el, index)"
          type="button"
          role="radio"
          class="ui-seg__item"
          :aria-checked="index === selectedIndex"
          :aria-label="option.ariaLabel ?? option.label"
          :tabindex="index === tabStop ? 0 : -1"
          @click="select(index)"
          @keydown="onKeydown($event, index)"
        >
          <component :is="option.icon" v-if="option.icon" :size="size === 'sm' ? 14 : 16" />
          <span v-else>{{ option.label }}</span>
        </button>
      </UiTooltip>
      <button
        v-else
        :ref="(el) => setItemRef(el, index)"
        type="button"
        role="radio"
        class="ui-seg__item"
        :aria-checked="index === selectedIndex"
        :aria-label="option.ariaLabel"
        :tabindex="index === tabStop ? 0 : -1"
        @click="select(index)"
        @keydown="onKeydown($event, index)"
      >
        <component :is="option.icon" v-if="option.icon" :size="size === 'sm' ? 14 : 16" />
        <span class="ui-seg__label">{{ option.label }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.ui-seg {
  --_item-h: 28px;
  position: relative;
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  padding: 2px;
  border-radius: var(--radius-md);
  background-color: var(--bg-muted);
  isolation: isolate;
}
.ui-seg--sm {
  --_item-h: 24px;
}
.ui-seg--block {
  display: grid;
  width: 100%;
}

.ui-seg__thumb {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  z-index: 0;
  border-radius: var(--radius-sm);
  background-color: var(--bg-surface);
  box-shadow: var(--shadow-xs);
  transition: transform var(--dur-base) var(--ease-standard);
}
[data-theme="dark"] .ui-seg__thumb {
  background-color: var(--bg-raised);
}

.ui-seg__item {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1-5);
  min-width: 0;
  height: var(--_item-h);
  padding: 0 var(--space-3);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  transition: color var(--dur-fast) var(--ease-standard);
}
.ui-seg--sm .ui-seg__item {
  padding: 0 var(--space-2);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
}
.ui-seg--icon-only .ui-seg__item {
  padding: 0;
  min-width: calc(var(--_item-h) + 4px);
}
.ui-seg__item:hover,
.ui-seg__item[aria-checked="true"] {
  color: var(--text-primary);
}
.ui-seg__item:focus-visible {
  outline-offset: 0;
}
.ui-seg__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (pointer: coarse) {
  .ui-seg,
  .ui-seg--sm {
    --_item-h: 40px;
  }
}

@media (forced-colors: active) {
  .ui-seg {
    border: 1px solid CanvasText;
  }
  .ui-seg__thumb {
    display: none;
  }
  .ui-seg__item[aria-checked="true"] {
    forced-color-adjust: none;
    background-color: Highlight;
    color: HighlightText;
  }
}
</style>
