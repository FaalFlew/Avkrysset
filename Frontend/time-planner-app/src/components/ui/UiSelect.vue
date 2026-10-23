<script setup lang="ts" generic="T extends string | number">
/**
 * UiSelect — native <select> styled like UiInput (appearance: none + ChevronDown).
 * Generic over the option value type T (string | number); the emitted value keeps its type.
 * Props:
 *   modelValue?: T | null (v-model)
 *   options: SelectOption<T>[] — { value, label, disabled? }
 *   placeholder?: string — disabled first option shown while modelValue is null/unset
 *   label?, hideLabel?, hint?, error?, size? ('md' | 'lg'), id? — same as UiInput
 * Slots: label-end — content on the right of the label row
 * Attrs: `class`/`style` → wrapper; everything else → native <select> (name, required, listeners…).
 * Exposes: focus(), selectEl
 */
import { computed, ref, useAttrs, useId } from "vue";
import type { HTMLAttributes, StyleValue } from "vue";
import { ChevronDown, CircleAlert } from "lucide-vue-next";
import type { SelectOption } from "./types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue?: T | null;
    options: SelectOption<T>[];
    placeholder?: string;
    label?: string;
    hideLabel?: boolean;
    hint?: string;
    error?: string;
    size?: "md" | "lg";
    id?: string;
  }>(),
  {
    modelValue: null,
    placeholder: undefined,
    label: undefined,
    hideLabel: false,
    hint: undefined,
    error: undefined,
    size: "md",
    id: undefined,
  },
);

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const attrs = useAttrs();
const generatedId = useId();
const selectId = computed(() => props.id ?? `ui-select-${generatedId}`);
const hintId = computed(() => `${selectId.value}-hint`);
const errorId = computed(() => `${selectId.value}-error`);
const selectEl = ref<HTMLSelectElement | null>(null);

const rootAttrs = computed(() => ({
  class: attrs.class as HTMLAttributes["class"],
  style: attrs.style as StyleValue,
}));
const selectAttrs = computed(() =>
  Object.fromEntries(
    Object.entries(attrs).filter(([key]) => key !== "class" && key !== "style" && key !== "aria-describedby"),
  ),
);

const describedBy = computed(() => {
  const ids = [attrs["aria-describedby"] as string | undefined];
  if (props.hint) ids.push(hintId.value);
  if (props.error) ids.push(errorId.value);
  return ids.filter(Boolean).join(" ") || undefined;
});

const hasValue = computed(() => props.options.some((o) => o.value === props.modelValue));
const currentValue = computed(() => (hasValue.value ? String(props.modelValue) : ""));

function onChange(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value;
  const option = props.options.find((o) => String(o.value) === raw);
  if (option) emit("update:modelValue", option.value);
}

function focus(options?: FocusOptions): void {
  selectEl.value?.focus(options);
}

defineExpose({ focus, selectEl });
</script>

<template>
  <div class="ui-field" v-bind="rootAttrs">
    <div v-if="label" class="ui-field__label-row" :class="{ 'sr-only': hideLabel && !$slots['label-end'] }">
      <label :for="selectId" class="ui-field__label" :class="{ 'sr-only': hideLabel }">{{ label }}</label>
      <slot name="label-end" />
    </div>
    <div class="ui-select" :class="[`ui-select--${size}`, { 'is-invalid': !!error }]">
      <select
        :id="selectId"
        ref="selectEl"
        v-bind="selectAttrs"
        class="ui-select__native"
        :value="currentValue"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @change="onChange"
      >
        <option v-if="placeholder || !hasValue" value="" disabled :hidden="!placeholder">
          {{ placeholder ?? "" }}
        </option>
        <option
          v-for="option in options"
          :key="String(option.value)"
          :value="String(option.value)"
          :disabled="option.disabled"
        >
          {{ option.label }}
        </option>
      </select>
      <ChevronDown class="ui-select__chevron" :size="16" />
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

.ui-select {
  --_h: var(--control-h-md);
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}
.ui-select--lg {
  --_h: var(--control-h-lg);
}

.ui-select__native {
  width: 100%;
  min-width: 0;
  height: var(--_h);
  padding: 0 calc(var(--space-3) + 16px + var(--space-2)) 0 var(--space-3);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-md);
  background-color: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--input-font-size);
  line-height: var(--lh-14);
  text-overflow: ellipsis;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-standard),
    box-shadow var(--dur-fast) var(--ease-standard);
}
.ui-select__native:hover {
  border-color: var(--border-input-hover);
}
.ui-select__native:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--focus-ring-soft);
}
.ui-select.is-invalid .ui-select__native {
  border-color: var(--danger);
}
.ui-select__native:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: var(--bg-subtle);
}
.ui-select__native option {
  background-color: var(--bg-raised);
  color: var(--text-primary);
}

.ui-select__chevron {
  position: absolute;
  right: var(--space-3);
  color: var(--text-tertiary);
  pointer-events: none;
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
  .ui-select__native {
    border-color: CanvasText;
  }
  .ui-select__native:focus {
    outline: 2px solid Highlight;
    outline-offset: 1px;
  }
}
</style>
