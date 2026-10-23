<!-- src/components/TaskEditor.vue -->
<template>
  <!-- The modal-overlay handles closing when the backdrop is clicked -->
  <div class="modal-overlay" @click.self="closeModal">
    <div class="modal-content">
      <h3>{{ isEditing ? "Edit Task" : "Create Task" }}</h3>

      <form @submit.prevent="handleSave">
        <!-- Title Input -->
        <div class="form-group">
          <label for="title">Title</label>
          <input id="title" v-model="title" type="text" required />
        </div>

        <!-- Date and Time Inputs -->
        <div class="form-group-inline">
          <div class="form-group">
            <label for="date">Date</label>
            <input id="date" v-model="datePart" type="date" required />
          </div>
          <div class="form-group">
            <label for="start-time">Start Time</label>
            <input id="start-time" v-model="timePart" type="time" required />
          </div>
        </div>

        <!-- Duration and Category Inputs -->
        <div class="form-group-inline">
          <div class="form-group">
            <label for="duration">Duration (hours)</label>
            <input
              id="duration"
              v-model.number="duration"
              type="number"
              step="0.25"
              min="0.25"
              required
            />
          </div>
          <div class="form-group">
            <label for="category">Category</label>
            <select
              id="category"
              v-model="selectedCategoryId"
              @change="handleCategoryChange"
              required
            >
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">
                {{ cat.name }}
              </option>
              <!-- This special option triggers the category editor -->
              <option value="_createNew" class="create-new-option">
                -- Create New Category --
              </option>
            </select>
          </div>
        </div>

        <!-- Template Section (only shows when creating a new task) -->
        <div v-if="!isEditing" class="template-section">
          <h4>Or click a template to add instantly</h4>
          <ul class="template-list">
            <li
              v-for="template in templates"
              :key="template.id"
              @click="applyTemplateAndSave(template)"
            >
              <span
                class="template-title"
                :style="{ borderLeftColor: template.categoryColor }"
              >
                {{ template.title }}
              </span>
              <span class="template-details">
                ({{ template.duration }}h, {{ template.categoryName }})
              </span>
            </li>
          </ul>
        </div>

        <!-- Action Buttons -->
        <div class="form-actions">
          <button type="button" class="btn-secondary" @click="closeModal">
            Cancel
          </button>
          <button type="submit" class="btn-primary">Save Task</button>
          <button
            v-if="isEditing"
            type="button"
            class="btn-danger"
            @click="handleDelete"
          >
            Delete
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- The CategoryEditor modal is teleported to the body to avoid z-index issues -->
  <Teleport to="body">
    <CategoryEditor
      v-if="isCategoryEditorOpen"
      @close="isCategoryEditorOpen = false"
      @category-created="onCategoryCreated"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useTasks } from "@/composables/useTasks";
import { useUIStore } from "@/stores/uiStore";
import dayjs from "dayjs";
import { Task, TaskTemplate, Category } from "@/types";
import CategoryEditor from "./CategoryEditor.vue";

// --- PROPS & EMITS ---
const props = defineProps<{
  // The task to edit (if any). If null, it's in "create" mode.
  taskToEdit?: Task | null;
  // The start time for a new task when clicking on an empty cell.
  initialDate?: string;
}>();

const emit = defineEmits(["close"]);

// --- COMPONENT STATE ---
const { categories, templates, addTask, updateTask, deleteTask } = useTasks();
const uiStore = useUIStore();

const isEditing = computed(() => !!props.taskToEdit);
const isCategoryEditorOpen = ref(false);

// Local state for the form fields
const title = ref("");
const datePart = ref("");
const timePart = ref("");
const duration = ref(1);
const selectedCategoryId = ref("");

// --- WATCHER to populate the form ---
// This watcher syncs the form's local state with the props.
watch(
  () => props.taskToEdit || props.initialDate,
  (newValue) => {
    // Determine the data source: either the task to edit or the initial date for a new task
    const sourceDate =
      props.taskToEdit?.start || props.initialDate || dayjs().toISOString();
    const task = props.taskToEdit;

    title.value = task?.title || "";
    datePart.value = dayjs(sourceDate).format("YYYY-MM-DD");
    timePart.value = dayjs(sourceDate).format("HH:mm");
    duration.value = task?.duration || 1;
    // Set a default category if none is provided
    selectedCategoryId.value =
      task?.categoryId || categories.value[0]?.id || "";
  },
  { immediate: true }
);

// --- METHODS ---
const closeModal = () => {
  emit("close");
};

// Combines date and time parts into a full ISO string for the backend
const getStartDateTime = () => {
  return dayjs(`${datePart.value}T${timePart.value}`).toISOString();
};

const handleCategoryChange = () => {
  if (selectedCategoryId.value === "_createNew") {
    // Temporarily reset the select to the first category to avoid showing "-- Create --"
    const prevId =
      props.taskToEdit?.categoryId || categories.value[0]?.id || "";
    selectedCategoryId.value = prevId;
    isCategoryEditorOpen.value = true;
  }
};

// This is the new event handler for the auto-select feature
const onCategoryCreated = (newCategory: Category) => {
  // Set the form's selected category to the one just created
  selectedCategoryId.value = newCategory.id;
  isCategoryEditorOpen.value = false;
};

// Handles clicking on a template
const applyTemplateAndSave = async (template: TaskTemplate) => {
  const success = await addTask({
    title: template.title,
    duration: template.duration,
    categoryId: template.categoryId,
    templateId: template.id,
    start: getStartDateTime(),
  });
  if (success) closeModal();
};

// Handles form submission for both create and edit
const handleSave = async () => {
  if (isEditing.value && props.taskToEdit) {
    // --- EDIT LOGIC ---
    const updatedTask: Task = {
      ...props.taskToEdit,
      title: title.value,
      start: getStartDateTime(),
      duration: duration.value,
      categoryId: selectedCategoryId.value,
    };
    const success = await updateTask(updatedTask);
    if (success) closeModal();
  } else {
    // --- CREATE LOGIC ---
    const success = await addTask({
      title: title.value,
      start: getStartDateTime(),
      duration: duration.value,
      categoryId: selectedCategoryId.value,
    });
    if (success) closeModal();
  }
};

// Handles deleting a task
const handleDelete = async () => {
  if (isEditing.value && props.taskToEdit) {
    const confirmed = await uiStore.confirm(
      "Delete Task?",
      "Are you sure you want to delete this task? This action cannot be undone."
    );
    if (confirmed) {
      await deleteTask(props.taskToEdit.id);
      closeModal();
    }
  }
};
</script>

<style scoped>
* {
  box-sizing: border-box;
}
/* Styles are unchanged */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}
.modal-content {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
}
h3 {
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #333;
}
.form-group {
  margin-bottom: 1rem;
}
label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: #555;
}
input,
select {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
}
.form-actions {
  margin-top: 2rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.template-section {
  margin-top: 2rem;
  border-top: 1px solid #eee;
  padding-top: 1rem;
}
.template-header {
  margin-top: 0;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
  color: #666;
  font-weight: 500;
}
.template-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 150px;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 4px;
}
.template-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  cursor: pointer;
  transition: background-color 0.2s;
  border-bottom: 1px solid #f0f0f0;
}
.template-list li:last-child {
  border-bottom: none;
}
.template-list li:hover {
  background-color: #f4f5f7;
}
.template-title {
  font-weight: 500;
  border-left: 4px solid #ccc;
  padding-left: 8px;
}
.template-details {
  color: #666;
  font-size: 0.9rem;
}
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}
.modal-content {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  display: flex; /* Added for layout control */
  flex-direction: column; /* Added */
}
h3 {
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #333;
  flex-shrink: 0;
}
form {
  overflow-y: auto; /* Allow form itself to scroll if content overflows */
}
.create-new-option {
  font-style: italic;
  color: var(--primary-color);
  font-weight: 500;
}
/* ... other existing styles for form elements, templates, etc. ... */

/* --- NEW: Media Query for Mobile Responsiveness --- */
@media (max-width: 768px) {
  /* FIX for Modal Overflow */
  .modal-content {
    width: 95%;
    /* Constrain height to be 90% of the viewport, leaving some space at top/bottom */
    max-height: 90vh;
    padding: 1.5rem;
  }
}
</style>
