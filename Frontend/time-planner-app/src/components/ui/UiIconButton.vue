<script setup lang="ts">
/**
 * UiIconButton — square icon-only button with a required accessible label and a tooltip.
 * Props:
 *   label: string — aria-label and tooltip text (required)
 *   variant?: 'ghost' | 'secondary' | 'primary' | 'danger-ghost' (default 'ghost')
 *   size?: 'sm' (28) | 'md' (32) | 'lg' (40) — default 'md'; ≥ 40px on coarse pointers
 *   pressed?: boolean — sets aria-pressed (toggle buttons); omit for plain buttons
 *   shortcut?: string[] — shown as <UiKbd> in the tooltip and exposed via aria-keyshortcuts
 *   tooltip?: boolean (default true)
 *   tooltipPlacement?: 'top' | 'bottom' | 'left' | 'right' (default 'top')
 *   type?: 'button' | 'submit' | 'reset' (default 'button')
 *   disabled?: boolean
 *   to?: LinkTarget — renders a RouterLink instead of a button
 * Slots: default — the icon (pass :size="16"; 18–20 for nav/tab bar)
 * Attrs: forwarded to the native element (inheritAttrs: false).
 */
import { computed, ref, useAttrs, type ComponentPublicInstance } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import UiTooltip from "./UiTooltip.vue";
import type { IconButtonVariant, LinkTarget } from "./types";
import { isMac } from "@/lib/platform";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    label: string;
    variant?: IconButtonVariant;
    size?: "sm" | "md" | "lg";
    pressed?: boolean;
    shortcut?: string[];
    tooltip?: boolean;
    tooltipPlacement?: "top" | "bottom" | "left" | "right";
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    to?: LinkTarget;
  }>(),
  {
    variant: "ghost",
    size: "md",
    pressed: undefined,
    shortcut: undefined,
    tooltip: true,
    tooltipPlacement: "top",
    type: "button",
    disabled: false,
    to: undefined,
  },
);

const attrs = useAttrs();

// The tooltip attaches to the rendered element, so the button/link stays the component root
// (parent scoped styles and classes apply to it directly).
const el = ref<HTMLElement | null>(null);
function setEl(target: Element | ComponentPublicInstance | null): void {
  const node = target && "$el" in target ? (target.$el as Element) : target;
  el.value = node instanceof HTMLElement ? node : null;
}

defineExpose({ el });
const isLink = computed(() => props.to !== undefined && !props.disabled);
const linkTo = computed(() => props.to as RouteLocationRaw);

const keyShortcuts = computed(() => {
  if (!props.shortcut?.length) return undefined;
  return props.shortcut
    .map((k) => (k === "Mod" ? (isMac ? "Meta" : "Control") : k === "Esc" ? "Escape" : k))
    .join("+");
});

const classes = computed(() => ["ui-icon-button", `ui-icon-button--${props.variant}`, `ui-icon-button--${props.size}`]);
</script>

<template>
  <RouterLink
    v-if="isLink"
    v-bind="attrs"
    :ref="setEl"
    :to="linkTo"
    :class="classes"
    :aria-label="label"
    :aria-keyshortcuts="keyShortcuts"
  >
    <slot />
    <UiTooltip
      v-if="tooltip"
      :target="el"
      :text="label"
      :shortcut="shortcut"
      :placement="tooltipPlacement"
      :disabled="disabled"
    />
  </RouterLink>
  <button
    v-else
    v-bind="attrs"
    :ref="setEl"
    :type="type"
    :class="classes"
    :aria-label="label"
    :aria-pressed="pressed === undefined ? undefined : pressed"
    :aria-keyshortcuts="keyShortcuts"
    :disabled="disabled || undefined"
  >
    <slot />
    <UiTooltip
      v-if="tooltip"
      :target="el"
      :text="label"
      :shortcut="shortcut"
      :placement="tooltipPlacement"
      :disabled="disabled"
    />
  </button>
</template>

<style scoped>
.ui-icon-button {
  --_s: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: var(--_s);
  height: var(--_s);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background-color: transparent;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}

.ui-icon-button--sm {
  --_s: 28px;
  border-radius: var(--radius-sm);
}
.ui-icon-button--lg {
  --_s: 40px;
}
@media (pointer: coarse) {
  .ui-icon-button {
    --_s: 40px;
  }
  .ui-icon-button--lg {
    --_s: 44px;
  }
}

/* ghost */
.ui-icon-button--ghost:not(:disabled):hover {
  background-color: var(--bg-subtle);
  color: var(--text-primary);
}
.ui-icon-button--ghost:not(:disabled):active,
.ui-icon-button--ghost[aria-pressed="true"] {
  background-color: var(--bg-muted);
  color: var(--text-primary);
}

/* secondary */
.ui-icon-button--secondary {
  background-color: var(--bg-surface);
  border-color: var(--border-default);
  color: var(--text-primary);
}
.ui-icon-button--secondary:not(:disabled):hover {
  background-color: var(--bg-subtle);
  border-color: var(--border-strong);
}
.ui-icon-button--secondary:not(:disabled):active,
.ui-icon-button--secondary[aria-pressed="true"] {
  background-color: var(--bg-muted);
}

/* primary */
.ui-icon-button--primary {
  background-color: var(--accent);
  color: var(--text-on-accent);
  box-shadow: var(--shadow-xs);
}
.ui-icon-button--primary:not(:disabled):hover {
  background-color: var(--accent-hover);
}
.ui-icon-button--primary:not(:disabled):active {
  background-color: var(--accent-active);
}

/* danger-ghost */
.ui-icon-button--danger-ghost {
  color: var(--danger-text);
}
.ui-icon-button--danger-ghost:not(:disabled):hover {
  background-color: var(--danger-subtle);
}

.ui-icon-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (forced-colors: active) {
  .ui-icon-button[aria-pressed="true"] {
    border-color: Highlight;
  }
}
</style>
