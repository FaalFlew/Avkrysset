<!-- src/components/TemplateEditor.vue -->
<script setup lang="ts">
/**
 * TemplateEditor — create or edit a task template (UiDialog, size sm): title (≤ 200), duration
 * chips plus a custom "Hours" field (step 0.25), category chips (+ new category).
 * Create uses addTemplate, edit uses updateTemplate; closes only on success.
 * Props: open (v-model:open), templateToEdit?: TaskTemplate | null
 */
import { computed, ref, watch } from "vue";
import type { Category, TaskTemplate } from "@/types";
import UiDialog from "@/components/ui/UiDialog.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiInput from "@/components/ui/UiInput.vue";
import CategoryChips from "@/components/planner/CategoryChips.vue";
import DurationChips from "@/components/planner/DurationChips.vue";
import CategoryEditor from "./CategoryEditor.vue";
import { useTasks } from "@/composables/useTasks";

const props = withDefaults(defineProps<{ templateToEdit?: TaskTemplate | null }>(), { templateToEdit: null });
const open = defineModel<boolean>("open", { default: false });

const { categories, addTemplate, updateTemplate } = useTasks();

const isEditing = computed(() => !!props.templateToEdit);
const title = ref("");
const hours = ref<number | null>(1);
const categoryId = ref("");
const titleError = ref("");
const hoursError = ref("");
const saving = ref(false);
const categoryEditorOpen = ref(false);

function defaultCategoryId(): string {
  return categories.value.find((c) => c.name !== "Other")?.id ?? categories.value[0]?.id ?? "";
}

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    const t = props.templateToEdit;
    title.value = t?.title ?? "";
    hours.value = t?.duration ?? 1;
    categoryId.value = t?.categoryId ?? defaultCategoryId();
    titleError.value = "";
    hoursError.value = "";
    saving.value = false;
  },
  { immediate: true }
);

const durationMinutes = computed({
  get: () => Math.round((hours.value ?? 0) * 60),
  set: (minutes: number) => {
    hours.value = minutes / 60;
    hoursError.value = "";
  },
});

function onCategoryCreated(category: Category): void {
  categoryId.value = category.id;
}

async function save(): Promise<void> {
  if (saving.value) return;
  const trimmed = title.value.trim();
  titleError.value = trimmed ? "" : "Give the template a name.";
  const h = hours.value ?? 0;
  hoursError.value = h >= 0.25 && h <= 24 ? "" : "Use a duration between 0.25 and 24 hours.";
  if (titleError.value || hoursError.value || !categoryId.value) return;

  saving.value = true;
  try {
    const data = { title: trimmed, duration: Math.round(h * 4) / 4, categoryId: categoryId.value };
    const ok = props.templateToEdit
      ? await updateTemplate({ ...props.templateToEdit, ...data })
      : !!(await addTemplate(data));
    if (ok) open.value = false;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <UiDialog v-model:open="open" :title="isEditing ? 'Edit template' : 'New template'" size="sm">
    <form id="template-form" class="tpl-form" novalidate @submit.prevent="save">
      <UiInput
        v-model="title"
        label="Title"
        placeholder="e.g. Deep work"
        maxlength="200"
        autocomplete="off"
        data-autofocus
        :error="titleError || undefined"
        @update:model-value="titleError = ''"
      />

      <div class="tpl-form__section">
        <p class="tpl-form__label" id="tpl-duration-label">Duration</p>
        <DurationChips v-model="durationMinutes" label="Duration" />
        <UiInput
          v-model="hours"
          class="tpl-form__hours"
          label="Hours"
          type="number"
          step="0.25"
          min="0.25"
          max="24"
          inputmode="decimal"
          :error="hoursError || undefined"
          @update:model-value="hoursError = ''"
        />
      </div>

      <div class="tpl-form__section">
        <p class="tpl-form__label">Category</p>
        <CategoryChips v-model="categoryId" :categories="categories" label="Category" @create="categoryEditorOpen = true" />
      </div>
    </form>

    <template #footer="{ close }">
      <UiButton variant="ghost" @click="close('button')">Cancel</UiButton>
      <UiButton variant="primary" type="submit" form="template-form" :loading="saving">
        {{ isEditing ? "Save" : "Add template" }}
      </UiButton>
    </template>
  </UiDialog>

  <CategoryEditor v-model:open="categoryEditorOpen" @saved="onCategoryCreated" />
</template>

<style scoped>
.tpl-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.tpl-form__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.tpl-form__label {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
}
.tpl-form__hours {
  max-width: 140px;
}
</style>
