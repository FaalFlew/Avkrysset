<!-- src/components/TaskEditor.vue -->
<script setup lang="ts">
/**
 * TaskEditor — the one global create/edit dialog (mounted in App.vue, driven by useTaskEditor()).
 * Anchored next to the block/draft at ≥ 1024px, centered on tablets (or without an anchor),
 * a bottom sheet on phones.
 *
 * Body: title (Enter saves) · templates (create mode; click = add instantly at the draft start)
 * · date / start / end (end ≤ start means "+1 day") · duration chips · category chips (+ new).
 * Footer: Delete (edit; no confirm — optimistic with Undo) · Cancel · Add task / Save (↵).
 * Ctrl/⌘+Enter saves from any field. Failed saves keep the dialog open (the store toasts why).
 * "More actions" (edit and read-only views): Copy (then tap/click a time in the planner to paste)
 * and Duplicate to the next day / week — all act on the saved task and close the editor, like
 * Delete. A new task's default duration fits the free time before the next task; when not even
 * 15 minutes are free a note says so (saving still runs the overlap check).
 *
 * Datetime rules preserved from the datetime hand-off: when the date and start fields are left
 * unchanged, the original start instant is kept exactly (DST fall-back safety); a DST-gap or
 * ambiguous time shows a hint.
 */
import { computed, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { CalendarPlus, CalendarPlus2, CircleAlert, Copy, Ellipsis, Trash2, X } from "lucide-vue-next";
import type { Category, Task, TaskTemplate } from "@/types";
import UiDialog from "@/components/ui/UiDialog.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiIconButton from "@/components/ui/UiIconButton.vue";
import UiInput from "@/components/ui/UiInput.vue";
import UiKbd from "@/components/ui/UiKbd.vue";
import UiMenu from "@/components/ui/UiMenu.vue";
import type { MenuItem } from "@/components/ui/types";
import CategoryChips from "@/components/planner/CategoryChips.vue";
import DurationChips from "@/components/planner/DurationChips.vue";
import CategoryEditor from "./CategoryEditor.vue";
import { useTasks } from "@/composables/useTasks";
import { useTaskEditor } from "@/composables/useTaskEditor";
import { useBreakpoint } from "@/composables/useMediaQuery";
import { isModKey } from "@/lib/platform";
import {
  addMinutes,
  combineDateAndTime,
  diffMinutes,
  endAtTimeOfDay,
  formatDate,
  formatDurationMinutes,
  formatTime,
  formatTimeOfDay,
  isDateKey,
  isTimeOfDay,
  nowInstant,
  resolveWallClock,
  splitInstant,
  toDateKey,
  type UtcIsoString,
} from "@/lib/datetime";
import { displayTitle, formatTaskTimeRange } from "@/lib/plannerFormat";
import { canDeleteTask, editorModeFor, isOrgTask, orgAttribution, organizationLabel, orgMonogram } from "@/lib/taskAccess";
import { useCurrentUserId } from "@/composables/useCurrentUser";
import { OTHER_COLOR } from "@/lib/categoryPalette";
import { readLastCategory, rememberCategory } from "@/lib/lastCategory";
import { freeTimeNote } from "@/lib/newTaskDuration";
import { isMutationSlow } from "@/services/slowRequests";
import { useClipboardStore } from "@/stores/clipboardStore";
import { useUIStore } from "@/stores/uiStore";

const TEMPLATE_PREVIEW_COUNT = 6;

const editor = useTaskEditor();
const { state, draft } = editor;
const { categories, templates, addTask, updateTask, deleteTask } = useTasks();
const { isCoarse } = useBreakpoint();

const open = computed({
  get: () => state.open,
  set: (value: boolean) => {
    if (!value) editor.close();
  },
});
/** The task being edited (a plain copy made by openEdit). */
const task = computed<Task | null>(() => (state.mode === "edit" ? (state.task as unknown as Task | null) : null));
/** create | edit | readonly (an org task an admin assigned to me, Q1). */
const mode = computed(() => editorModeFor(task.value));
const isEditing = computed(() => mode.value === "edit");
const isReadOnly = computed(() => mode.value === "readonly");
const orgName = computed(() => (task.value && isOrgTask(task.value) ? organizationLabel(task.value) : null));
const dialogTitle = computed(() => {
  if (isReadOnly.value) return `Task in ${orgName.value}`;
  return isEditing.value ? "Edit task" : "New task";
});
const canDelete = computed(() => !!task.value && canDeleteTask(task.value));
const currentUserId = useCurrentUserId();
/** "Assigned by Ana · Acme" / "Created by you · Acme" + "for you and 2 others" (see orgAttribution). */
const attribution = computed(() => {
  const t = task.value;
  return t && orgName.value ? orgAttribution(t, currentUserId.value, isReadOnly.value) : null;
});
const orgLine = computed(() => attribution.value?.line ?? "");
const orgForWhom = computed(() => attribution.value?.forWhom ?? null);
const assigneeNames = computed(() => attribution.value?.people ?? []);

/**
 * Category choices: mine, plus the task's own category when it is someone else's (org tasks use
 * the creator's category; the server accepts it unchanged).
 */
const editorCategories = computed<Category[]>(() => {
  const own = categories.value;
  const t = task.value;
  if (t && t.categoryId && !own.some((c) => c.id === t.categoryId)) {
    return [{ id: t.categoryId, name: t.categoryName || "Category", color: t.categoryColor || OTHER_COLOR }, ...own];
  }
  return own;
});

// ------------------------------------------------------------------ fields
const title = ref("");
const datePart = ref("");
const timePart = ref("");
const durationMin = ref(60);
const categoryId = ref("");
const titleError = ref("");
const dateError = ref("");
const startError = ref("");
const categoryError = ref("");
const saving = ref(false);
const showAllTemplates = ref(false);
const categoryEditorOpen = ref(false);
const templateRow = ref<HTMLElement | null>(null);

// The instant the form was filled from, and the fields it produced: unchanged fields keep the
// exact original start (in the repeated hour of a DST fall-back, re-resolving "02:30" would
// otherwise move the task by an hour).
let prefilledStart: UtcIsoString = "";
let prefilledFields = { date: "", time: "" };

function defaultCategoryId(): string {
  const last = readLastCategory();
  if (last && categories.value.some((c) => c.id === last)) return last;
  return categories.value.find((c) => c.name !== "Other")?.id ?? categories.value[0]?.id ?? "";
}

function initFields(): void {
  const task = state.mode === "edit" ? state.task : null;
  const providedStart = task?.start || draft.start || "";
  let fields: { date: string; time: string };
  try {
    fields = splitInstant(providedStart || nowInstant());
    prefilledStart = providedStart;
  } catch {
    fields = splitInstant(nowInstant());
    prefilledStart = "";
  }
  prefilledFields = fields;

  // A blank-looking (whitespace-only, legacy) title starts empty so the placeholder shows.
  const initialTitle = task?.title ?? draft.title ?? "";
  title.value = initialTitle.trim() ? initialTitle : "";
  datePart.value = fields.date;
  timePart.value = fields.time;
  durationMin.value = Math.max(1, Math.round((task?.duration ?? draft.durationH ?? 1) * 60));
  categoryId.value = task?.categoryId || defaultCategoryId();
  titleError.value = "";
  dateError.value = "";
  startError.value = "";
  categoryError.value = "";
  saving.value = false;
  showAllTemplates.value = false;
}

watch(
  () => state.session,
  () => {
    if (state.open) initFields();
  },
  { immediate: true }
);

// Categories may arrive after the editor opened (cold start): pick a default then.
watch(editorCategories, () => {
  if (state.open && !editorCategories.value.some((c) => c.id === categoryId.value)) categoryId.value = defaultCategoryId();
});

/** Start instant from the date + time fields (unchanged fields keep the original). Null when invalid. */
function getStartDateTime(): UtcIsoString | null {
  if (!isDateKey(datePart.value) || !isTimeOfDay(timePart.value)) return null;
  if (prefilledStart && datePart.value === prefilledFields.date && timePart.value === prefilledFields.time) {
    return prefilledStart;
  }
  return combineDateAndTime(datePart.value, timePart.value);
}

const startInstant = computed(() => getStartDateTime());
const endInstantValue = computed(() => (startInstant.value ? addMinutes(startInstant.value, durationMin.value) : null));
const endTime = computed(() => (endInstantValue.value ? splitInstant(endInstantValue.value).time : ""));
const endsNextDay = computed(
  () => !!startInstant.value && !!endInstantValue.value && toDateKey(endInstantValue.value) !== toDateKey(startInstant.value)
);
const durationText = computed(() => formatDurationMinutes(durationMin.value));

function onEndInput(value: string | number | null): void {
  const time = String(value ?? "");
  const start = startInstant.value;
  if (!start || !isTimeOfDay(time)) return;
  const { end } = endAtTimeOfDay(start, time);
  durationMin.value = Math.max(1, Math.round(diffMinutes(end, start)));
}

// Explains DST surprises for the chosen local date + time.
const startTimeHint = computed(() => {
  if (!isDateKey(datePart.value) || !isTimeOfDay(timePart.value)) return "";
  const { instant, status } = resolveWallClock(datePart.value, timePart.value);
  if (status === "gap") {
    return `${formatTimeOfDay(timePart.value)} doesn't exist on this date (clocks move forward); the task will start at ${formatTime(instant)}.`;
  }
  if (status === "ambiguous" && getStartDateTime() !== prefilledStart) {
    return `${formatTimeOfDay(timePart.value)} happens twice on this date (clocks move back); the first occurrence is used.`;
  }
  return "";
});

// Keep the planner's draft block in sync with the fields.
watch([title, startInstant, durationMin, categoryId], () => {
  if (!state.open) return;
  draft.title = title.value;
  if (startInstant.value) draft.start = startInstant.value;
  draft.durationH = durationMin.value / 60;
  draft.categoryId = categoryId.value;
});

// ------------------------------------------------------------------ templates
const filteredTemplates = computed(() => {
  const query = title.value.trim().toLocaleLowerCase();
  if (!query) return templates.value;
  return templates.value.filter((t) => t.title.toLocaleLowerCase().includes(query));
});
const visibleTemplates = computed(() =>
  showAllTemplates.value ? filteredTemplates.value : filteredTemplates.value.slice(0, TEMPLATE_PREVIEW_COUNT)
);
const hiddenTemplateCount = computed(() => filteredTemplates.value.length - visibleTemplates.value.length);
const templateTabStop = ref(0);
watch(visibleTemplates, () => {
  templateTabStop.value = 0;
});

function templateColor(template: TaskTemplate): string {
  return categories.value.find((c) => c.id === template.categoryId)?.color ?? template.categoryColor;
}

function templateButtons(): HTMLButtonElement[] {
  return Array.from(templateRow.value?.querySelectorAll<HTMLButtonElement>("button") ?? []);
}

function focusTemplate(index: number): void {
  const buttons = templateButtons();
  if (buttons.length === 0) return;
  const i = (index + buttons.length) % buttons.length;
  templateTabStop.value = i;
  buttons[i]?.focus();
}

function onTemplateKeydown(event: KeyboardEvent, index: number): void {
  if (event.key === "ArrowRight") focusTemplate(index + 1);
  else if (event.key === "ArrowLeft") focusTemplate(index - 1);
  else if (event.key === "Home") focusTemplate(0);
  else if (event.key === "End") focusTemplate(templateButtons().length - 1);
  else if (event.key === "ArrowUp") document.getElementById("task-editor-title")?.focus();
  else return;
  event.preventDefault();
}

function onTitleKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" && !isEditing.value && visibleTemplates.value.length > 0) {
    event.preventDefault();
    focusTemplate(0);
  }
}

async function applyTemplate(template: TaskTemplate): Promise<void> {
  if (saving.value) return;
  const start = startInstant.value;
  if (!start) return;
  saving.value = true;
  try {
    const created = await addTask({
      title: template.title,
      duration: template.duration,
      categoryId: template.categoryId,
      templateId: template.id,
      start,
    });
    if (created) finish(created);
  } finally {
    saving.value = false;
  }
}

// ------------------------------------------------------------------ save / delete
function finish(task: Task): void {
  rememberCategory(task.categoryId);
  editor.markSaved(task.id);
  editor.close();
}

/** Inline validation: errors on every invalid field, focus on the first one. */
function validate(): boolean {
  titleError.value = title.value.trim() ? "" : "Give the task a name.";
  dateError.value = isDateKey(datePart.value) ? "" : "Pick a date.";
  startError.value = isTimeOfDay(timePart.value) ? "" : "Pick a start time.";
  categoryError.value = editorCategories.value.some((c) => c.id === categoryId.value)
    ? ""
    : editorCategories.value.length === 0
      ? "Add a category first."
      : "Pick a category.";
  const firstInvalid = [
    [titleError.value, "#task-editor-title"],
    [dateError.value, "#task-editor-date"],
    [startError.value, "#task-editor-start"],
    [categoryError.value, ".editor__categories [role='radio'][tabindex='0'], .editor__categories button"],
  ].find(([error]) => !!error);
  if (firstInvalid) {
    document.querySelector<HTMLElement>(`.task-editor ${firstInvalid[1]}`)?.focus();
    return false;
  }
  return true;
}

async function save(): Promise<void> {
  if (saving.value || isReadOnly.value) return;
  if (!validate()) return;
  const trimmed = title.value.trim();
  const start = startInstant.value;
  if (!start) return;

  saving.value = true;
  try {
    const duration = durationMin.value / 60;
    if (isEditing.value && task.value) {
      const updated: Task = {
        ...task.value,
        title: trimmed,
        start,
        duration,
        categoryId: categoryId.value,
      };
      if (await updateTask(updated, { silentSuccess: true })) finish(updated);
    } else {
      const created = await addTask({ title: trimmed, start, duration, categoryId: categoryId.value });
      if (created) finish(created);
    }
  } finally {
    saving.value = false;
  }
}

function remove(): void {
  const current = task.value;
  if (!current || !canDelete.value) return;
  editor.close();
  void deleteTask(current.id);
}

// ------------------------------------------------------------------ copy / duplicate
const clipboard = useClipboardStore();
const uiStore = useUIStore();

/** New task: "Only 10 min free before “Standup”." when not even 15 minutes fit before the next task. */
const durationNote = computed(() =>
  mode.value === "create" && startInstant.value ? freeTimeNote(editor.suggestDurationAt(startInstant.value)) : ""
);

function copyTask(): void {
  const current = task.value;
  if (!current) return;
  editor.close();
  clipboard.copy(current, { arm: true });
  // The planner shows a "Tap a time to paste" banner; elsewhere, say where to go.
  if (!editor.isPlannerShown()) {
    uiStore.showToast(
      `Copied “${displayTitle(current.title)}”. ${isCoarse.value ? "Tap" : "Click"} a time in the planner to paste it.`,
      "info",
      5000
    );
  }
}

function duplicateTask(days: number): void {
  const current = task.value;
  if (!current) return;
  editor.close();
  void clipboard.duplicate(current, days);
}

const moreItems = computed<MenuItem[]>(() => [
  {
    id: "copy",
    label: "Copy",
    icon: Copy,
    description: isReadOnly.value ? "As a personal task" : undefined,
    onSelect: copyTask,
  },
  { id: "duplicate-day", label: "Duplicate to next day", icon: CalendarPlus, onSelect: () => duplicateTask(1) },
  { id: "duplicate-week", label: "Duplicate to next week", icon: CalendarPlus2, onSelect: () => duplicateTask(7) },
]);

// Read-only view (Q1): what, when, who.
const readOnlyWhen = computed(() => {
  const t = task.value;
  if (!t) return "";
  return `${formatDate(t.start, "weekday")} · ${formatTaskTimeRange(t.start, t.duration)}`;
});
/**
 * Category of the read-only view. An assigned org task counts under its ORGANIZATION (as in
 * analytics and its task list) — never the creator's own (private) category name. The opener may
 * pass the grouping it shows (name + color, e.g. the analytics task list).
 */
const readOnlyCategory = computed(() => {
  const t = task.value;
  if (!t) return { name: "", color: OTHER_COLOR };
  if (isOrgTask(t)) {
    const hint = state.categoryHint;
    return { name: hint?.name || organizationLabel(t), color: hint?.color || t.categoryColor || OTHER_COLOR };
  }
  const own = categories.value.find((c) => c.id === t.categoryId);
  return { name: own?.name ?? t.categoryName, color: own?.color ?? t.categoryColor ?? OTHER_COLOR };
});

function onPanelKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && isModKey(event)) {
    event.preventDefault();
    void save();
  }
}

function onCategoryCreated(category: Category): void {
  categoryId.value = category.id;
}

const invalidStart = computed(() => !isDateKey(datePart.value) || !isTimeOfDay(timePart.value));
</script>

<template>
  <UiDialog
    v-model:open="open"
    :title="dialogTitle"
    hide-header
    size="md"
    :anchor-rect="state.anchorRect"
    class="task-editor"
    @keydown="onPanelKeydown"
  >
    <!-- Read-only org task (assigned by an admin, Q1): facts + Close. -->
    <div v-if="isReadOnly && task" class="editor editor--readonly">
      <div class="editor__head">
        <p class="editor__kind" aria-hidden="true">{{ dialogTitle }}</p>
        <div class="editor__head-actions">
          <UiMenu :items="moreItems" placement="bottom-end">
            <template #trigger="{ toggle, triggerProps }">
              <UiIconButton label="More actions" size="sm" :tooltip="false" v-bind="triggerProps" @click="toggle">
                <Ellipsis :size="16" />
              </UiIconButton>
            </template>
          </UiMenu>
          <UiIconButton label="Close" size="sm" :tooltip="false" @click="open = false">
            <X :size="16" />
          </UiIconButton>
        </div>
      </div>
      <div class="ro__heading">
        <span class="org-badge" aria-hidden="true">{{ orgMonogram(orgName) }}</span>
        <h3 class="ro__title">{{ displayTitle(task.title) }}</h3>
      </div>
      <p v-if="orgLine" class="ro__assigned">{{ orgLine }}</p>
      <dl class="ro__facts">
        <div class="ro__fact">
          <dt>When</dt>
          <dd class="tabular">{{ readOnlyWhen }}</dd>
        </div>
        <div class="ro__fact">
          <dt>Duration</dt>
          <dd class="tabular">{{ formatDurationMinutes(task.duration * 60) }}</dd>
        </div>
        <div class="ro__fact">
          <dt>Category</dt>
          <dd>
            <span class="ro__dot" :style="{ backgroundColor: readOnlyCategory.color }" aria-hidden="true" />
            {{ readOnlyCategory.name }}
          </dd>
        </div>
        <div v-if="assigneeNames.length > 0" class="ro__fact">
          <dt>Assigned to</dt>
          <dd>
            <ul class="ro__people" role="list">
              <li v-for="(name, i) in assigneeNames" :key="i">{{ name }}</li>
            </ul>
          </dd>
        </div>
      </dl>
      <p class="ro__note">Only an admin of {{ orgName }} can change this task.</p>
    </div>

    <form v-else id="task-editor-form" class="editor" novalidate @submit.prevent="save">
      <div class="editor__head">
        <p class="editor__kind" aria-hidden="true">{{ dialogTitle }}</p>
        <div class="editor__head-actions">
          <UiMenu v-if="isEditing" :items="moreItems" placement="bottom-end">
            <template #trigger="{ toggle, triggerProps }">
              <UiIconButton label="More actions" size="sm" :tooltip="false" v-bind="triggerProps" @click="toggle">
                <Ellipsis :size="16" />
              </UiIconButton>
            </template>
          </UiMenu>
          <UiIconButton label="Close" size="sm" :tooltip="false" @click="open = false">
            <X :size="16" />
          </UiIconButton>
        </div>
      </div>
      <div v-if="orgLine" class="editor__org">
        <span class="org-badge" aria-hidden="true">{{ orgMonogram(orgName) }}</span>
        <span>{{ orgLine }}</span>
        <span v-if="orgForWhom" class="editor__org-people">· {{ orgForWhom }}</span>
      </div>

      <UiInput
        id="task-editor-title"
        v-model="title"
        class="editor__title"
        label="Title"
        hide-label
        size="lg"
        placeholder="Task name"
        autocomplete="off"
        data-autofocus
        :error="titleError || undefined"
        @update:model-value="titleError = ''"
        @keydown="onTitleKeydown"
      />

      <!-- Templates (create mode) -->
      <section v-if="!isEditing" class="editor__section" aria-labelledby="editor-templates-label">
        <template v-if="templates.length > 0">
          <template v-if="filteredTemplates.length > 0">
            <p id="editor-templates-label" class="editor__caption">Templates · add instantly</p>
            <div ref="templateRow" class="templates" role="toolbar" aria-labelledby="editor-templates-label">
              <button
                v-for="(template, index) in visibleTemplates"
                :key="template.id"
                type="button"
                class="template-chip"
                :tabindex="index === templateTabStop ? 0 : -1"
                :disabled="saving || invalidStart"
                :aria-label="`Add ${displayTitle(template.title, 'Untitled template')}, ${formatDurationMinutes(template.duration * 60)}, ${template.categoryName}`"
                :title="displayTitle(template.title, 'Untitled template')"
                @click="applyTemplate(template)"
                @keydown="onTemplateKeydown($event, index)"
              >
                <span class="template-chip__dot" :style="{ backgroundColor: templateColor(template) }" />
                <span class="template-chip__title">{{ displayTitle(template.title, "Untitled template") }}</span>
                <span class="template-chip__meta tabular">{{ formatDurationMinutes(template.duration * 60) }}</span>
              </button>
              <button
                v-if="hiddenTemplateCount > 0"
                type="button"
                class="template-chip template-chip--more"
                tabindex="-1"
                @click="showAllTemplates = true"
                @keydown="onTemplateKeydown($event, visibleTemplates.length)"
              >
                {{ hiddenTemplateCount }} more
              </button>
            </div>
          </template>
        </template>
        <p v-else id="editor-templates-label" class="editor__muted">
          No templates yet ·
          <RouterLink to="/templates" @click="open = false">Create one</RouterLink>
        </p>
      </section>

      <!-- When -->
      <fieldset class="editor__when">
        <legend class="sr-only">When</legend>
        <UiInput
          id="task-editor-date"
          v-model="datePart"
          class="editor__date"
          label="Date"
          type="date"
          required
          :error="dateError || undefined"
          @update:model-value="dateError = ''"
        />
        <UiInput
          id="task-editor-start"
          v-model="timePart"
          label="Start"
          type="time"
          step="900"
          required
          :error="startError || undefined"
          @update:model-value="startError = ''"
        />
        <UiInput
          :model-value="endTime"
          label="End"
          type="time"
          step="900"
          :hint="endsNextDay ? '+1 day' : undefined"
          @update:model-value="onEndInput"
        />
      </fieldset>
      <p v-if="startTimeHint" class="editor__hint" role="note">{{ startTimeHint }}</p>

      <div class="editor__section">
        <DurationChips v-model="durationMin" />
        <p class="editor__muted tabular" aria-live="polite">Duration {{ durationText }}</p>
        <p v-if="durationNote" class="editor__note" role="note">{{ durationNote }}</p>
      </div>

      <div class="editor__section editor__categories">
        <p id="editor-category-label" class="editor__caption">Category</p>
        <CategoryChips
          v-model="categoryId"
          :categories="editorCategories"
          label="Category"
          @update:model-value="categoryError = ''"
          @create="categoryEditorOpen = true"
        />
        <p v-if="categoryError" class="editor__error" role="alert">
          <CircleAlert :size="14" />
          <span>{{ categoryError }}</span>
        </p>
      </div>
    </form>

    <template #footer>
      <template v-if="isReadOnly">
        <UiButton variant="secondary" data-autofocus @click="open = false">Close</UiButton>
      </template>
      <template v-else>
        <UiButton v-if="isEditing && canDelete" variant="danger-ghost" class="editor__delete" @click="remove">
          <template #leading><Trash2 :size="16" /></template>
          Delete
        </UiButton>
        <UiButton variant="ghost" @click="open = false">Cancel</UiButton>
        <!-- While a modal is open the app-wide "Waking up the server…" pill stands down; the
             button says it instead. -->
        <UiButton variant="primary" type="submit" form="task-editor-form" :loading="saving">
          {{ saving && isMutationSlow ? "Waking up the server…" : isEditing ? "Save" : "Add task" }}
          <template v-if="!isCoarse" #trailing><UiKbd :keys="['Enter']" tone="onAccent" /></template>
        </UiButton>
      </template>
    </template>
  </UiDialog>

  <CategoryEditor v-model:open="categoryEditorOpen" @saved="onCategoryCreated" />
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.editor__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: calc(var(--space-2) * -1) calc(var(--space-2) * -1) calc(var(--space-2) * -1) 0;
}
/* ----- org tasks ----- */
.org-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 20px;
  height: 20px;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background-color: var(--bg-muted);
  color: var(--text-secondary);
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-semibold);
}
.editor__org {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1-5);
  margin-top: calc(var(--space-2) * -1);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
.editor__org-people {
  color: var(--text-tertiary);
}
.ro__heading {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}
.ro__heading .org-badge {
  margin-top: 3px;
}
.ro__title {
  font-size: var(--fs-17);
  line-height: var(--lh-17);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  overflow-wrap: anywhere;
}
.ro__assigned {
  margin-top: calc(var(--space-3) * -1);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
.ro__facts {
  display: flex;
  flex-direction: column;
  gap: var(--space-2-5);
  margin: 0;
}
.ro__fact {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: var(--space-3);
  font-size: var(--fs-14);
  line-height: var(--lh-14);
}
.ro__fact dt {
  color: var(--text-tertiary);
  font-size: var(--fs-13);
}
.ro__fact dd {
  margin: 0;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.ro__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: var(--space-1);
  border-radius: var(--radius-full);
}
.ro__people {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ro__note {
  padding: var(--space-2) var(--space-2-5);
  border-radius: var(--radius-md);
  background-color: var(--bg-subtle);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-secondary);
}
.editor__head-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.editor__note {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--warning-text);
}
.editor__kind {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--text-secondary);
}

/* Title: borderless until focused. */
.editor__title :deep(.ui-input) {
  border-color: transparent;
  background-color: transparent;
  margin: 0 -14px;
}
.editor__title :deep(.ui-input:hover) {
  border-color: var(--border-default);
}
.editor__title :deep(.ui-input:focus-within) {
  border-color: var(--accent);
  background-color: var(--bg-input);
}
.editor__title :deep(.ui-input__native) {
  font-size: var(--fs-17);
  line-height: var(--lh-17);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
}
@media (pointer: coarse) {
  .editor__title :deep(.ui-input__native) {
    font-size: max(16px, var(--fs-17));
  }
}

.editor__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.editor__caption {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  font-weight: var(--fw-medium);
  color: var(--text-tertiary);
}
.editor__muted {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}
.editor__error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-1);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--danger-text);
}
.editor__error .lucide {
  margin-top: 1px;
}
.editor__hint {
  margin-top: calc(var(--space-2) * -1);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--warning-text);
}

.templates {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1-5);
}
.template-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  max-width: 100%;
  height: 28px;
  padding: 0 var(--space-2-5);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background-color: var(--bg-surface);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
  transition: background-color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
}
@media (pointer: coarse) {
  .template-chip {
    height: 36px;
  }
}
.template-chip:hover:not(:disabled) {
  background-color: var(--bg-subtle);
  border-color: var(--border-strong);
}
.template-chip:disabled {
  opacity: 0.5;
}
.template-chip__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}
.template-chip__title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.template-chip__meta {
  color: var(--text-tertiary);
  font-weight: var(--fw-regular);
}
.template-chip--more {
  color: var(--text-secondary);
  border-style: dashed;
}

.editor__when {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
@media (max-width: 479.98px) {
  .editor__when {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .editor__date {
    grid-column: 1 / -1;
  }
}

.editor__delete {
  margin-right: auto;
}
</style>
