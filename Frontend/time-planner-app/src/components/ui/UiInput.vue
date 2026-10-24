<script setup lang="ts">
/**
 * UiInput — labelled text field.
 * Props:
 *   modelValue?: string | number | null (v-model). For type="number" the emitted value is
 *     `number | null` (null when empty); otherwise a string.
 *   label?: string — visible label above the field (fs-13/500)
 *   hideLabel?: boolean — keep the label for screen readers only
 *   hint?: string — helper text below (fs-12, tertiary); linked via aria-describedby
 *   error?: string — error text below (danger, CircleAlert icon); sets aria-invalid and
 *     aria-describedby; announced through a polite live region
 *   size?: 'md' | 'lg' (default 'md')
 *   type?: string (default 'text')
 *   id?: string (default: generated with useId())
 * Slots:
 *   leading — icon inside the field on the left (pointer-events: none)
 *   trailing — interactive content inside the field on the right (e.g. an icon button)
 *   label-end — content on the right of the label row (e.g. a "Forgot password?" link)
 * Attrs: `class`/`style` go to the outer wrapper; everything else (placeholder, autocomplete,
 *   inputmode, required, name, maxlength, listeners, data-autofocus, aria-describedby, …) goes
 *   to the native <input>. An `aria-describedby` attr is merged with the hint/error ids.
 * Exposes: focus(), select(), inputEl
 */
import { computed, ref, useAttrs, useId, useSlots } from "vue";
import type { HTMLAttributes, StyleValue } from "vue";
import { CircleAlert } from "lucide-vue-next";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null;
    label?: string;
    hideLabel?: boolean;
    hint?: string;
    error?: string;
    size?: "md" | "lg";
    type?: string;
    id?: string;
  }>(),
  {
    modelValue: "",
    label: undefined,
    hideLabel: false,
    hint: undefined,
    error: undefined,
    size: "md",
    type: "text",
    id: undefined,
  },
);

const emit = defineEmits<{ "update:modelValue": [value: string | number | null] }>();

const attrs = useAttrs();
const slots = useSlots();
const generatedId = useId();
const inputId = computed(() => props.id ?? `ui-input-${generatedId}`);
const hintId = computed(() => `${inputId.value}-hint`);
const errorId = computed(() => `${inputId.value}-error`);
const inputEl = ref<HTMLInputElement | null>(null);

const rootAttrs = computed(() => ({
  class: attrs.class as HTMLAttributes["class"],
  style: attrs.style as StyleValue,
}));
const inputAttrs = computed(() =>
  Object.fromEntries(
    Object.entries(attrs).filter(([key]) => key !== "class" && key !== "style" && key !== "aria-describedby"),
  ),
);

const describedBy = computed(() => {
  const ids = [attrs["aria-describedby"] as string | undefined];
  if (props.hint) ids.push(hintId.value);
  if (props.error) ids.push(errorId.value);
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
});

const displayValue = computed(() => (props.modelValue === null || props.modelValue === undefined ? "" : String(props.modelValue)));

function onInput(event: Event): void {
  const el = event.target as HTMLInputElement;
  if (props.type === "number") {
    emit("update:modelValue", el.value === "" || Number.isNaN(el.valueAsNumber) ? null : el.valueAsNumber);
  } else {
    emit("update:modelValue", el.value);
  }
}

function focus(options?: FocusOptions): void {
  inputEl.value?.focus(options);
}
function select(): void {
  inputEl.value?.select();
}

defineExpose({ focus, select, inputEl });
</script>

<template>
  <div class="ui-field" v-bind="rootAttrs">
    <div v-if="label" class="ui-field__label-row" :class="{ 'sr-only': hideLabel && !slots['label-end'] }">
      <label :for="inputId" class="ui-field__label" :class="{ 'sr-only': hideLabel }">{{ label }}</label>
      <slot name="label-end" />
    </div>
    <div
      class="ui-input"
      :class="[
        `ui-input--${size}`,
        { 'is-invalid': !!error, 'has-leading': !!slots.leading, 'has-trailing': !!slots.trailing },
      ]"
    >
      <span v-if="slots.leading" class="ui-input__leading"><slot name="leading" /></span>
      <input
        :id="inputId"
        ref="inputEl"
        v-bind="inputAttrs"
        class="ui-input__native"
        :type="type"
        :value="displayValue"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @input="onInput"
      />
      <span v-if="slots.trailing" class="ui-input__trailing"><slot name="trailing" /></span>
    </div>
    <p v-if="hint" :id="hintId" class="ui-field__hint">{{ hint }}</p>
    <div class="ui-field__live" aria-live="polite">
      <p v-if="error" :id="errorId" class="ui-field__error">
        <CircleAlert :size="14" />
        <span>{{ error }}</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.ui-field {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.ui-field__label-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-1-5);
}

.ui-field__label {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
}

.ui-input {
  --_h: var(--control-h-md);
  position: relative;
  display: flex;
  align-items: center;
  min-height: var(--_h);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-md);
  background-color: var(--bg-input);
  color: var(--text-primary);
  transition: border-color var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}
.ui-input--lg {
  --_h: var(--control-h-lg);
}
.ui-input:hover {
  border-color: var(--border-input-hover);
}
.ui-input:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring-soft);
}
.ui-input.is-invalid {
  border-color: var(--danger);
}
.ui-input.is-invalid:focus-within {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 22%, transparent);
}

.ui-input__native {
  flex: 1 1 auto;
  min-width: 0;
  width: 100%;
  height: calc(var(--_h) - 2px);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  font-size: var(--input-font-size);
  line-height: var(--lh-14);
  outline: none;
}
.ui-input__native:focus-visible {
  outline: none;
}
.ui-input--lg .ui-input__native {
  padding: 0 14px;
}
.has-leading .ui-input__native {
  padding-left: 0;
}
.has-trailing .ui-input__native {
  padding-right: 0;
}
.ui-input__native:disabled {
  cursor: not-allowed;
}
.ui-input:has(.ui-input__native:disabled) {
  opacity: 0.5;
  background-color: var(--bg-subtle);
}
/* Native date/time pickers: keep the indicator on-theme and comfortably clickable. */
.ui-input__native::-webkit-calendar-picker-indicator {
  cursor: pointer;
  opacity: 0.7;
}

.ui-input__leading {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--space-2) 0 var(--space-3);
  color: var(--text-tertiary);
  pointer-events: none;
}
.ui-input__trailing {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-1) 0 var(--space-2);
}

.ui-field__hint {
  margin-top: var(--space-1-5);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}

.ui-field__error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-1);
  margin-top: var(--space-1-5);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--danger-text);
}
.ui-field__error .lucide {
  margin-top: 1px;
}

@media (forced-colors: active) {
  .ui-input {
    border-color: CanvasText;
  }
  .ui-input:focus-within {
    outline: 2px solid Highlight;
    outline-offset: 1px;
  }
}
</style>
