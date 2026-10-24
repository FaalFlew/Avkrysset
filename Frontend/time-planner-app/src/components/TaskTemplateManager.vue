<!-- src/components/TaskTemplateManager.vue — the /templates page -->
<script setup lang="ts">
/**
 * Templates & categories. Templates are added to the calendar from the task editor's template
 * row (one click). Rows show Edit/Delete icon buttons (on hover/focus with a mouse, always on
 * touch). Deletes ask for confirmation in the danger tone.
 */
import { computed, nextTick, ref } from "vue";
import { storeToRefs } from "pinia";
import { LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-vue-next";
import type { Category, TaskTemplate } from "@/types";
import UiPageHeader from "@/components/ui/UiPageHeader.vue";
import UiCard from "@/components/ui/UiCard.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiIconButton from "@/components/ui/UiIconButton.vue";
import UiBadge from "@/components/ui/UiBadge.vue";
import UiEmptyState from "@/components/ui/UiEmptyState.vue";
import UiErrorState from "@/components/ui/UiErrorState.vue";
import UiSkeleton from "@/components/ui/UiSkeleton.vue";
import CategoryEditor from "./CategoryEditor.vue";
import TemplateEditor from "./TemplateEditor.vue";
import { useTasks } from "@/composables/useTasks";
import { useTaskStore } from "@/stores/taskStore";
import { useUIStore } from "@/stores/uiStore";
import { formatDurationMinutes } from "@/lib/datetime";
import { displayTitle } from "@/lib/plannerFormat";
import { OTHER_COLOR } from "@/lib/categoryPalette";

const { templates, categories, deleteTemplate, deleteCategory, otherCategoryId, getCategory } = useTasks();
const taskStore = useTaskStore();
const uiStore = useUIStore();
const { isInitializing, initError } = storeToRefs(taskStore);

const templateEditorOpen = ref(false);
const templateToEdit = ref<TaskTemplate | null>(null);
const categoryEditorOpen = ref(false);
const categoryToEdit = ref<Category | null>(null);

const isLoading = computed(() => isInitializing.value && templates.value.length === 0 && categories.value.length === 0);
const showInitError = computed(() => !!initError.value && categories.value.length === 0);
const onlyOther = computed(() => categories.value.length <= 1);

function categoryOf(template: TaskTemplate) {
  const category = getCategory(template.categoryId);
  return {
    color: category?.color ?? template.categoryColor ?? OTHER_COLOR,
    name: category?.name ?? template.categoryName,
  };
}

function newTemplate(): void {
  templateToEdit.value = null;
  templateEditorOpen.value = true;
}
function editTemplate(template: TaskTemplate): void {
  templateToEdit.value = template;
  templateEditorOpen.value = true;
}
function newCategory(): void {
  categoryToEdit.value = null;
  categoryEditorOpen.value = true;
}
function editCategory(category: Category): void {
  categoryToEdit.value = category;
  categoryEditorOpen.value = true;
}

const templateList = ref<HTMLElement | null>(null);
const categoryList = ref<HTMLElement | null>(null);

/**
 * After a row is deleted its buttons disappear (and focus with them): move focus to the row now
 * at the same position (or the one before), else to the card's "New …" button.
 */
async function focusAfterRemoval(list: HTMLElement | null, index: number, fallback: string): Promise<void> {
  await nextTick();
  const rows = Array.from(list?.querySelectorAll<HTMLElement>("li.row") ?? []);
  const candidates = [rows[index], rows[index - 1]];
  for (const row of candidates) {
    const button = row?.querySelector<HTMLElement>(".row__actions button");
    if (button) {
      button.focus();
      return;
    }
  }
  document.querySelector<HTMLElement>(`[data-focus-fallback="${fallback}"]`)?.focus();
}

async function confirmDeleteTemplate(template: TaskTemplate): Promise<void> {
  const confirmed = await uiStore.confirm(
    `Delete template “${template.title}”?`,
    "Tasks you already scheduled from it stay on your calendar.",
    { confirmText: "Delete template", cancelText: "Cancel", tone: "danger" }
  );
  if (!confirmed) return;
  const index = templates.value.findIndex((t) => t.id === template.id);
  if (await deleteTemplate(template.id)) await focusAfterRemoval(templateList.value, index, "templates");
}

async function confirmDeleteCategory(category: Category): Promise<void> {
  const confirmed = await uiStore.confirm(
    `Delete “${category.name}”?`,
    "Tasks and templates in this category will move to “Other”. This can't be undone.",
    { confirmText: "Delete category", cancelText: "Cancel", tone: "danger" }
  );
  if (!confirmed) return;
  const index = categories.value.findIndex((c) => c.id === category.id);
  if (await deleteCategory(category.id)) await focusAfterRemoval(categoryList.value, index, "categories");
}

function retry(): void {
  void taskStore.initializeData();
}
</script>

<template>
  <div class="templates-page">
    <UiPageHeader title="Templates & categories" subtitle="Reusable tasks you can add to your week in one click.">
      <template #actions>
        <UiButton variant="primary" data-focus-fallback="templates" @click="newTemplate">
          <template #leading><Plus :size="16" /></template>
          New template
        </UiButton>
      </template>
    </UiPageHeader>

    <UiErrorState
      v-if="showInitError"
      title="Couldn't load your categories and templates"
      description="Check your connection and try again. If the server was asleep, it can take a few seconds to wake up."
      :retrying="isInitializing"
      @retry="retry"
    />

    <div v-else class="templates-page__grid">
      <!-- Templates -->
      <UiCard title="Templates" padding="none" class="list-card">
        <template #actions>
          <span class="list-card__count tabular" aria-hidden="true">{{ templates.length || "" }}</span>
        </template>
        <div v-if="isLoading" class="rows" aria-busy="true">
          <span class="sr-only">Loading…</span>
          <div v-for="i in 3" :key="i" class="row row--skeleton">
            <UiSkeleton width="45%" :height="14" />
          </div>
        </div>
        <UiEmptyState
          v-else-if="templates.length === 0"
          :icon="LayoutTemplate"
          title="No templates yet"
          description="Save tasks you repeat — like “Deep work · 2h” — and add them to your week in one click."
          size="sm"
          :heading-level="3"
        >
          <template #actions>
            <UiButton variant="secondary" size="sm" @click="newTemplate">
              <template #leading><Plus :size="14" /></template>
              New template
            </UiButton>
          </template>
        </UiEmptyState>
        <ul v-else ref="templateList" role="list" class="rows">
          <li v-for="template in templates" :key="template.id" class="row" :style="{ '--cat': categoryOf(template).color }">
            <div class="row__main">
              <span class="row__title" :title="displayTitle(template.title, 'Untitled template')">{{ displayTitle(template.title, "Untitled template") }}</span>
              <span class="row__meta tabular">
                <span class="row__duration">{{ formatDurationMinutes(template.duration * 60) }} ·</span>
                <span class="row__dot" aria-hidden="true" />
                <span class="row__category" :title="categoryOf(template).name">{{ categoryOf(template).name }}</span>
              </span>
            </div>
            <div class="row__actions">
              <UiIconButton :label="`Edit template ${template.title}`" size="sm" @click="editTemplate(template)">
                <Pencil :size="16" />
              </UiIconButton>
              <UiIconButton
                :label="`Delete template ${template.title}`"
                variant="danger-ghost"
                size="sm"
                @click="confirmDeleteTemplate(template)"
              >
                <Trash2 :size="16" />
              </UiIconButton>
            </div>
          </li>
        </ul>
      </UiCard>

      <!-- Categories -->
      <UiCard title="Categories" padding="none" class="list-card">
        <template #actions>
          <UiButton variant="ghost" size="sm" data-focus-fallback="categories" @click="newCategory">
            <template #leading><Plus :size="14" /></template>
            New category
          </UiButton>
        </template>
        <ul ref="categoryList" role="list" class="rows">
          <li v-for="category in categories" :key="category.id" class="row row--category">
            <span class="row__swatch" :style="{ backgroundColor: category.color }" aria-hidden="true" />
            <span class="row__title" :title="category.name">{{ category.name }}</span>
            <UiBadge v-if="category.id === otherCategoryId" class="row__badge">Default</UiBadge>
            <div v-else class="row__actions">
              <UiIconButton :label="`Edit category ${category.name}`" size="sm" @click="editCategory(category)">
                <Pencil :size="16" />
              </UiIconButton>
              <UiIconButton
                :label="`Delete category ${category.name}`"
                variant="danger-ghost"
                size="sm"
                @click="confirmDeleteCategory(category)"
              >
                <Trash2 :size="16" />
              </UiIconButton>
            </div>
          </li>
        </ul>
        <p v-if="onlyOther && !isLoading" class="list-card__helper">
          Add categories to color-code your week.
          <button type="button" class="link-button" @click="newCategory">+ New category</button>
        </p>
      </UiCard>
    </div>

    <TemplateEditor v-model:open="templateEditorOpen" :template-to-edit="templateToEdit" />
    <CategoryEditor v-model:open="categoryEditorOpen" :category-to-edit="categoryToEdit" />
  </div>
</template>

<style scoped>
.templates-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: var(--content-medium);
  margin: 0 auto;
  padding: var(--space-8) var(--space-6) var(--space-12);
}
@media (max-width: 767.98px) {
  .templates-page {
    padding: var(--space-5) var(--space-4) var(--space-10);
  }
}

.templates-page__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}
@media (min-width: 1024px) {
  .templates-page__grid {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  }
}

.list-card :deep(.ui-card__header) {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}
.list-card__count {
  font-size: var(--fs-12);
  color: var(--text-tertiary);
}
.list-card__helper {
  padding: var(--space-3) var(--space-4) var(--space-4);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
.link-button {
  margin-left: var(--space-1);
  color: var(--accent-text);
  font-weight: var(--fw-medium);
  border-radius: var(--radius-xs);
}
.link-button:hover {
  text-decoration: underline;
}

.rows {
  display: flex;
  flex-direction: column;
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 48px;
  padding: var(--space-1-5) var(--space-2) var(--space-1-5) var(--space-4);
  border-top: 1px solid var(--border-subtle);
  transition: background-color var(--dur-fast) var(--ease-standard);
}
.row:first-child {
  border-top: 0;
}
.row:hover {
  background-color: var(--bg-subtle);
}
.rows:not(.rows--plain) > .row:not(.row--category):not(.row--skeleton) {
  box-shadow: inset 3px 0 0 var(--cat);
}
.row__main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.row__title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
}
.row__meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
  white-space: nowrap;
}
.row__duration {
  flex-shrink: 0;
}
.row__category {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row__dot,
.row__swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background-color: var(--cat);
  flex-shrink: 0;
}
.row__swatch {
  width: 10px;
  height: 10px;
}
.row__badge {
  margin-right: var(--space-2);
}
.row__actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
/* Fine pointers: actions appear on hover / keyboard focus. Touch: always visible. */
@media (hover: hover) and (pointer: fine) {
  .row__actions {
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-standard);
  }
  .row:hover .row__actions,
  .row:focus-within .row__actions {
    opacity: 1;
  }
}
</style>
