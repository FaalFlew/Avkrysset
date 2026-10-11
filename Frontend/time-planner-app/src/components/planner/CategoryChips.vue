<script setup lang="ts">
/**
 * CategoryChips — single-choice category picker (role="radiogroup", roving tabindex;
 * arrows move + select, Home/End). Chips: 8px color dot + name; selected = tinted background,
 * 1px border in the category color and a check icon. Optional trailing "+ New category" button.
 * Props: modelValue (category id), categories, label (accessible group name), allowCreate
 * Emits: update:modelValue(id), create()
 */
import { computed, ref } from "vue";
import { Check, Plus } from "lucide-vue-next";
import type { Category } from "@/types";

const props = withDefaults(
  defineProps<{ modelValue: string; categories: readonly Category[]; label: string; allowCreate?: boolean }>(),
  { allowCreate: true }
);
const emit = defineEmits<{ "update:modelValue": [id: string]; create: [] }>();

const chipRefs: (HTMLButtonElement | null)[] = [];
const groupRef = ref<HTMLElement | null>(null);
function setRef(el: unknown, index: number): void {
  chipRefs[index] = el instanceof HTMLButtonElement ? el : null;
}

const selectedIndex = computed(() => props.categories.findIndex((c) => c.id === props.modelValue));
const tabStop = computed(() => (selectedIndex.value === -1 ? 0 : selectedIndex.value));

function choose(index: number, focus = false): void {
  const category = props.categories[index];
  if (!category) return;
  emit("update:modelValue", category.id);
  if (focus) chipRefs[index]?.focus();
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const count = props.categories.length;
  let next = -1;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % count;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + count) % count;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = count - 1;
  else if (event.key === " " || event.key === "Enter") {
    // Enter is left to the form (save); Space selects.
    if (event.key === " ") {
      event.preventDefault();
      choose(index);
    }
    return;
  }
  if (next === -1) return;
  event.preventDefault();
  event.stopPropagation();
  choose(next, true);
}

defineExpose({
  focus: () => chipRefs[tabStop.value]?.focus(),
  el: groupRef,
});
</script>

<template>
  <div ref="groupRef" class="category-chips">
    <div class="category-chips__group" role="radiogroup" :aria-label="label">
      <button
        v-for="(category, index) in categories"
        :key="category.id"
        :ref="(el) => setRef(el, index)"
        type="button"
        role="radio"
        class="chip"
        :class="{ 'is-selected': category.id === modelValue }"
        :style="{ '--cat': category.color }"
        :aria-checked="category.id === modelValue"
        :tabindex="index === tabStop ? 0 : -1"
        @click="choose(index)"
        @keydown="onKeydown($event, index)"
      >
        <Check v-if="category.id === modelValue" :size="14" class="chip__check" />
        <span v-else class="chip__dot" aria-hidden="true" />
        <span class="chip__label" :title="category.name">{{ category.name }}</span>
      </button>
      <button v-if="allowCreate" type="button" class="chip chip--create" @click="emit('create')">
        <Plus :size="14" />
        <span class="chip__label">New category</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.category-chips__group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1-5);
  max-height: 104px;
  overflow-y: auto;
  padding: 2px;
  margin: -2px;
}
@media (pointer: coarse) {
  .category-chips__group {
    max-height: 132px;
  }
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  max-width: 100%;
  height: 28px;
  padding: 0 var(--space-2-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background-color: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  transition: background-color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}
@media (pointer: coarse) {
  .chip {
    height: 36px;
  }
}
.chip:hover {
  background-color: var(--bg-subtle);
  color: var(--text-primary);
}
.chip__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background-color: var(--cat);
  flex-shrink: 0;
}
.chip__check {
  color: var(--cat);
}
.chip__label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip.is-selected {
  border-color: var(--cat);
  background-color: color-mix(in srgb, var(--cat) 14%, var(--bg-surface));
  color: var(--text-primary);
}
.chip--create {
  border-style: dashed;
  background-color: transparent;
  color: var(--text-secondary);
}
@media (forced-colors: active) {
  .chip.is-selected {
    outline: 2px solid Highlight;
  }
}
</style>
