<!-- src/components/CategoryEditor.vue -->
<script setup lang="ts">
/**
 * CategoryEditor — create or edit a category (UiDialog, size sm).
 * Name (≤ 100 chars), a radiogroup of the 12 validated color presets, a "Custom" swatch (native
 * color input) with a hex field (#RRGGBB, as the backend requires), and a live preview block in
 * the current theme. The dialog closes only when saving succeeded (the store toasts failures).
 * Props: open (v-model:open), categoryToEdit?: Category | null
 * Emits: saved(category) — after a successful create or update
 */
import { computed, nextTick, ref, watch } from "vue";
import { Check, Pipette, TriangleAlert } from "lucide-vue-next";
import type { Category } from "@/types";
import UiDialog from "@/components/ui/UiDialog.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiInput from "@/components/ui/UiInput.vue";
import { useTasks } from "@/composables/useTasks";
import { useTheme } from "@/composables/useTheme";
import { onSessionChange } from "@/composables/useSessionBound";
import { isMutationSlow } from "@/services/slowRequests";
import { CATEGORY_PRESETS, nextPresetColor } from "@/lib/categoryPalette";
import { blockColors, contrastRatio, isHex, normalizeHex } from "@/lib/color";
import { formatTimeOfDay } from "@/lib/datetime";

const props = withDefaults(defineProps<{ categoryToEdit?: Category | null }>(), { categoryToEdit: null });
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ saved: [category: Category] }>();

const { categories, addCategory, updateCategory } = useTasks();
const { resolvedTheme } = useTheme();

// The category belongs to the session it was opened in: close when that session ends.
onSessionChange(() => {
  open.value = false;
});

const isEditing = computed(() => !!props.categoryToEdit);
const name = ref("");
const color = ref<string>(CATEGORY_PRESETS[0]!.hex);
const hexInput = ref("");
const nameError = ref("");
const hexError = ref("");
const saving = ref(false);
const colorInput = ref<HTMLInputElement | null>(null);
const swatchRefs: (HTMLButtonElement | null)[] = [];

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    const editing = props.categoryToEdit;
    name.value = editing?.name ?? "";
    color.value = (editing?.color ?? nextPresetColor(categories.value.map((c) => c.color))).toUpperCase();
    hexInput.value = color.value;
    nameError.value = "";
    hexError.value = "";
    saving.value = false;
  },
  { immediate: true }
);

const presetIndex = computed(() => CATEGORY_PRESETS.findIndex((p) => p.hex === color.value.toUpperCase()));
const isCustom = computed(() => presetIndex.value === -1);
/** Roving tab stop: the selected swatch, or the Custom swatch when the color is custom. */
const tabStop = computed(() => (isCustom.value ? CATEGORY_PRESETS.length : presetIndex.value));

function setSwatchRef(el: unknown, index: number): void {
  swatchRefs[index] = el instanceof HTMLButtonElement ? el : null;
}

function pick(hex: string): void {
  color.value = hex.toUpperCase();
  hexInput.value = color.value;
  hexError.value = "";
}

function onSwatchKeydown(event: KeyboardEvent, index: number): void {
  const count = CATEGORY_PRESETS.length + 1; // + Custom
  let next = -1;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + count) % count;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = count - 1;
  if (next === -1) return;
  event.preventDefault();
  event.stopPropagation();
  if (next < CATEGORY_PRESETS.length) pick(CATEGORY_PRESETS[next]!.hex);
  void nextTick(() => swatchRefs[next]?.focus());
}

function openCustomPicker(): void {
  colorInput.value?.click();
}

function onNativeColor(event: Event): void {
  pick((event.target as HTMLInputElement).value);
}

function onHexInput(value: string | number | null): void {
  hexInput.value = String(value ?? "");
  const normalized = normalizeHex(hexInput.value);
  if (normalized) {
    color.value = normalized;
    hexError.value = "";
  }
}

function onHexBlur(): void {
  hexError.value = normalizeHex(hexInput.value) ? "" : "Use a hex color like #2F7FE0.";
}

/** --grid-bg of each theme (tokens.css): what task blocks sit on. */
const GRID_BACKGROUNDS = { light: "#FFFFFF", dark: "#141416" } as const;

/** Non-blocking warning when the color has < 3:1 contrast against the grid in either theme. */
const contrastWarning = computed(() => {
  const hex = normalizeHex(hexInput.value) ?? color.value;
  if (!isHex(hex)) return "";
  const weak = (["light", "dark"] as const).filter((theme) => contrastRatio(hex, GRID_BACKGROUNDS[theme]) < 3);
  if (weak.length === 0) return "";
  const where = weak.length === 2 ? "light and dark mode" : `${weak[0]} mode`;
  return `This color is hard to see in ${where}. A stronger color keeps the category easy to spot.`;
});

const previewStyle = computed(() => {
  // Same theme-adjusted colors as the planner blocks, so the preview shows what users will see.
  const palette = blockColors(color.value, resolvedTheme.value);
  return { "--cat": palette.color, "--_tint": palette.tint };
});
const previewTime = `${formatTimeOfDay(9 * 60)} – ${formatTimeOfDay(10 * 60 + 30)}`;

async function save(): Promise<void> {
  if (saving.value) return;
  const trimmed = name.value.trim();
  nameError.value = trimmed ? "" : "Give the category a name.";
  const hex = normalizeHex(hexInput.value) ?? color.value;
  if (!isHex(hex)) hexError.value = "Use a hex color like #2F7FE0.";
  if (nameError.value || hexError.value) return;

  saving.value = true;
  try {
    const data = { name: trimmed, color: hex };
    if (props.categoryToEdit) {
      const updated: Category = { ...props.categoryToEdit, ...data };
      if (await updateCategory(updated)) {
        emit("saved", updated);
        open.value = false;
      }
    } else {
      const created = await addCategory(data);
      if (created) {
        emit("saved", created);
        open.value = false;
      }
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UiDialog v-model:open="open" :title="isEditing ? 'Edit category' : 'New category'" size="sm">
    <form id="category-form" class="cat-form" novalidate @submit.prevent="save">
      <UiInput
        v-model="name"
        label="Name"
        placeholder="e.g. Deep work"
        maxlength="100"
        autocomplete="off"
        data-autofocus
        :error="nameError || undefined"
        @update:model-value="nameError = ''"
      />

      <fieldset class="cat-form__colors">
        <legend class="cat-form__label">Color</legend>
        <div class="swatches" role="radiogroup" aria-label="Color">
          <button
            v-for="(preset, index) in CATEGORY_PRESETS"
            :key="preset.hex"
            :ref="(el) => setSwatchRef(el, index)"
            type="button"
            role="radio"
            class="swatch"
            :style="{ '--sw': preset.hex }"
            :aria-checked="index === presetIndex"
            :aria-label="preset.name"
            :tabindex="index === tabStop ? 0 : -1"
            @click="pick(preset.hex)"
            @keydown="onSwatchKeydown($event, index)"
          >
            <Check v-if="index === presetIndex" :size="14" class="swatch__check" />
          </button>
          <button
            :ref="(el) => setSwatchRef(el, CATEGORY_PRESETS.length)"
            type="button"
            role="radio"
            class="swatch swatch--custom"
            :style="isCustom ? { '--sw': color } : undefined"
            :class="{ 'is-custom-selected': isCustom }"
            :aria-checked="isCustom"
            aria-label="Custom color"
            :tabindex="tabStop === CATEGORY_PRESETS.length ? 0 : -1"
            @click="openCustomPicker"
            @keydown="onSwatchKeydown($event, CATEGORY_PRESETS.length)"
          >
            <Check v-if="isCustom" :size="14" class="swatch__check" />
            <Pipette v-else :size="14" />
          </button>
          <input
            ref="colorInput"
            class="sr-only"
            type="color"
            tabindex="-1"
            aria-hidden="true"
            :value="color"
            @input="onNativeColor"
          />
        </div>
        <UiInput
          class="cat-form__hex"
          :model-value="hexInput"
          label="Hex"
          maxlength="7"
          autocomplete="off"
          spellcheck="false"
          :error="hexError || undefined"
          @update:model-value="onHexInput"
          @blur="onHexBlur"
        />
        <p v-if="contrastWarning && !hexError" class="cat-form__warning" role="status">
          <TriangleAlert :size="14" />
          <span>{{ contrastWarning }}</span>
        </p>
      </fieldset>

      <div class="cat-form__preview">
        <p class="cat-form__label" aria-hidden="true">Preview</p>
        <div class="preview-block" :style="previewStyle" aria-hidden="true">
          <span class="preview-block__title">{{ name.trim() || "Category name" }}</span>
          <span class="preview-block__time tabular">{{ previewTime }}</span>
        </div>
      </div>
    </form>

    <template #footer="{ close }">
      <UiButton variant="ghost" @click="close('button')">Cancel</UiButton>
      <UiButton variant="primary" type="submit" form="category-form" :loading="saving">
        {{ saving && isMutationSlow ? "Waking up the server…" : isEditing ? "Save" : "Add category" }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
.cat-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.cat-form__colors {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.cat-form__label {
  padding: 0;
  margin-bottom: var(--space-1-5);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.swatch {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-full);
  background-color: var(--sw);
  color: var(--text-on-accent);
  transition: box-shadow var(--dur-fast) var(--ease-standard);
}
@media (pointer: coarse) {
  .swatch {
    width: 40px;
    height: 40px;
  }
}
.swatch[aria-checked="true"] {
  box-shadow: 0 0 0 2px var(--bg-raised), 0 0 0 4px var(--focus-ring);
}
.swatch:focus-visible {
  outline-offset: 4px;
}
.swatch--custom {
  background-color: var(--bg-subtle);
  border: 1px dashed var(--border-strong);
  color: var(--text-secondary);
}
.swatch--custom.is-custom-selected {
  background-color: var(--sw);
  border-style: solid;
  border-color: transparent;
  color: var(--text-on-accent);
}
.swatch__check {
  filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.45));
}
.cat-form__warning {
  display: flex;
  align-items: flex-start;
  gap: var(--space-1);
  margin-top: calc(var(--space-1) * -1);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--warning-text);
}
.cat-form__warning .lucide {
  margin-top: 1px;
}
.cat-form__hex {
  max-width: 160px;
}

.preview-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px 6px 13px;
  border-radius: var(--radius-sm);
  background-color: color-mix(in srgb, var(--cat) var(--_tint), var(--grid-bg));
  box-shadow: inset 3px 0 0 var(--cat);
}
.preview-block__title {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-semibold);
  color: var(--block-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-block__time {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--block-meta);
}
</style>
