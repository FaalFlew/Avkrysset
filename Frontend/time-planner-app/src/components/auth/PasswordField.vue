<script setup lang="ts">
/**
 * PasswordField — UiInput (type password/text) with an Eye/EyeOff show-password toggle.
 * Props:
 *   modelValue: string (v-model)
 *   visible?: boolean (v-model:visible) — share one toggle between two fields (e.g. confirm)
 *   label?: string (default "Password")
 *   autocomplete?: 'current-password' | 'new-password' (default 'current-password')
 *   error?: string, hint?: string, id?: string, size?: 'md' | 'lg' (default 'lg')
 *   showToggle?: boolean (default true) — hide the eye button (field still follows `visible`)
 * Slots: label-end — e.g. a "Forgot password?" link on the label row
 * Attrs: forwarded to the native input (required, name, aria-describedby, …).
 * The toggle is a real button: aria-label "Show password" + aria-pressed (constant label,
 * pressed state carries the toggle — WAI-ARIA toggle-button pattern).
 * Exposes: focus()
 */
import { ref } from "vue";
import { Eye, EyeOff } from "lucide-vue-next";
import UiInput from "@/components/ui/UiInput.vue";
import UiIconButton from "@/components/ui/UiIconButton.vue";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    label?: string;
    autocomplete?: "current-password" | "new-password";
    error?: string;
    hint?: string;
    id?: string;
    size?: "md" | "lg";
    showToggle?: boolean;
  }>(),
  {
    label: "Password",
    autocomplete: "current-password",
    error: undefined,
    hint: undefined,
    id: undefined,
    size: "lg",
    showToggle: true,
  },
);

const model = defineModel<string>({ default: "" });
const visible = defineModel<boolean>("visible", { default: false });

const input = ref<InstanceType<typeof UiInput> | null>(null);

function focus(): void {
  input.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <UiInput
    ref="input"
    v-bind="$attrs"
    v-model="model"
    :id="id"
    :label="label"
    :type="visible ? 'text' : 'password'"
    :autocomplete="autocomplete"
    :error="error"
    :hint="hint"
    :size="size"
    autocapitalize="off"
    autocorrect="off"
    spellcheck="false"
  >
    <template v-if="$slots['label-end']" #label-end><slot name="label-end" /></template>
    <template v-if="showToggle" #trailing>
      <UiIconButton
        label="Show password"
        :pressed="visible"
        :size="size === 'lg' ? 'md' : 'sm'"
        @click="visible = !visible"
      >
        <EyeOff v-if="visible" :size="16" />
        <Eye v-else :size="16" />
      </UiIconButton>
    </template>
  </UiInput>
</template>
