<script setup lang="ts">
/**
 * UiButton — text button (or RouterLink when `to` is set).
 * Props:
 *   variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost' (default 'secondary')
 *   size?: 'sm' | 'md' | 'lg' (heights --control-h-*; default 'md')
 *   type?: 'button' | 'submit' | 'reset' (default 'button'; ignored for links)
 *   loading?: boolean — spinner replaces the `leading` slot (or is prepended), sets aria-busy and
 *     aria-disabled, and swallows clicks/submits. Native `disabled` is not used while loading so a
 *     focused button keeps focus.
 *   disabled?: boolean
 *   block?: boolean — full width (may shrink; the label truncates with an ellipsis)
 *   to?: LinkTarget — renders a RouterLink (a disabled link renders as a disabled <button>)
 * Layout: non-block buttons are `flex-shrink: 0` (never squeezed in flex rows). To let one shrink
 *   and truncate, give it a class with `flex-shrink: 1; min-width: 0`.
 * Slots: leading (icon, pass :size="16"), default (label), trailing (icon or <UiKbd>)
 * Attrs: forwarded to the native element (inheritAttrs: false), incl. listeners and data-*.
 */
import { computed, useAttrs } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import UiSpinner from "./UiSpinner.vue";
import type { ButtonVariant, LinkTarget } from "./types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: "sm" | "md" | "lg";
    type?: "button" | "submit" | "reset";
    loading?: boolean;
    disabled?: boolean;
    block?: boolean;
    to?: LinkTarget;
  }>(),
  { variant: "secondary", size: "md", type: "button", loading: false, disabled: false, block: false, to: undefined },
);

const attrs = useAttrs();
const isLink = computed(() => props.to !== undefined && !props.disabled);
const linkTo = computed(() => props.to as RouteLocationRaw);

const classes = computed(() => [
  "ui-button",
  `ui-button--${props.variant}`,
  `ui-button--${props.size}`,
  { "ui-button--block": props.block, "is-loading": props.loading },
]);

function onClickCapture(event: MouseEvent): void {
  if (props.loading) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
</script>

<template>
  <RouterLink
    v-if="isLink"
    v-bind="attrs"
    :to="linkTo"
    :class="classes"
    :aria-busy="loading || undefined"
    :aria-disabled="loading || undefined"
    @click.capture="onClickCapture"
  >
    <UiSpinner v-if="loading" :size="16" />
    <slot v-else name="leading" />
    <span v-if="$slots.default" class="ui-button__label"><slot /></span>
    <slot name="trailing" />
  </RouterLink>
  <button
    v-else
    v-bind="attrs"
    :type="type"
    :class="classes"
    :disabled="disabled || undefined"
    :aria-busy="loading || undefined"
    :aria-disabled="loading || undefined"
    @click.capture="onClickCapture"
  >
    <UiSpinner v-if="loading" :size="16" />
    <slot v-else name="leading" />
    <span v-if="$slots.default" class="ui-button__label"><slot /></span>
    <slot name="trailing" />
  </button>
</template>

<style scoped>
.ui-button {
  --_h: var(--control-h-md);
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1-5);
  height: var(--_h);
  /* Never squeeze a button inside a flex row ("Retry" must not become "R…"). Block buttons, or a
     consumer class with `flex-shrink: 1; min-width: 0`, opt into shrinking + label ellipsis. */
  flex-shrink: 0;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: inherit;
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  font-weight: var(--fw-medium);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  transition: background-color var(--dur-fast) var(--ease-standard),
    border-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}

.ui-button__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ui-button--sm {
  --_h: var(--control-h-sm);
  padding: 0 10px;
  font-size: var(--fs-13);
  line-height: var(--lh-13);
}
.ui-button--lg {
  --_h: var(--control-h-lg);
  padding: 0 18px;
}
.ui-button--block {
  display: flex;
  flex-shrink: 1;
  min-width: 0;
  width: 100%;
}

/* primary */
.ui-button--primary {
  background-color: var(--accent);
  color: var(--text-on-accent);
  box-shadow: var(--shadow-xs);
}
.ui-button--primary:not(:disabled):hover {
  background-color: var(--accent-hover);
}
.ui-button--primary:not(:disabled):active {
  background-color: var(--accent-active);
}

/* secondary */
.ui-button--secondary {
  background-color: var(--bg-surface);
  border-color: var(--border-default);
  color: var(--text-primary);
}
.ui-button--secondary:not(:disabled):hover {
  background-color: var(--bg-subtle);
  border-color: var(--border-strong);
}
.ui-button--secondary:not(:disabled):active {
  background-color: var(--bg-muted);
}

/* ghost */
.ui-button--ghost {
  background-color: transparent;
  color: var(--text-secondary);
}
.ui-button--ghost:not(:disabled):hover {
  background-color: var(--bg-subtle);
  color: var(--text-primary);
}
.ui-button--ghost:not(:disabled):active {
  background-color: var(--bg-muted);
}

/* danger */
.ui-button--danger {
  background-color: var(--danger);
  color: var(--text-on-accent);
  box-shadow: var(--shadow-xs);
}
.ui-button--danger:not(:disabled):hover {
  background-color: var(--danger-hover);
}

/* danger-ghost */
.ui-button--danger-ghost {
  background-color: transparent;
  color: var(--danger-text);
}
.ui-button--danger-ghost:not(:disabled):hover {
  background-color: var(--danger-subtle);
}

/* states */
.ui-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}
.ui-button.is-loading {
  cursor: progress;
}

@media (forced-colors: active) {
  .ui-button {
    border-color: ButtonText;
  }
  .ui-button:disabled {
    border-color: GrayText;
    color: GrayText;
  }
}
</style>
