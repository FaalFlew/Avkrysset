<!-- src/components/CategoryEditor.vue -->
<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <h3>{{ isEditing ? "Edit Category" : "Create New Category" }}</h3>
      <form @submit.prevent="handleSave">
        <div class="form-group">
          <label for="category-name">Category Name</label>
          <input
            id="category-name"
            v-model.trim="editableCategory.name"
            type="text"
            required
          />
        </div>
        <div class="form-group color-picker-group">
          <label for="category-color">Color</label>
          <input
            id="category-color"
            v-model="editableCategory.color"
            type="color"
          />
        </div>
        <div class="form-actions">
          <button type="button" class="btn-secondary" @click="$emit('close')">
            Cancel
          </button>
          <button type="submit" class="btn-primary">Save Category</button>
        </div>
      </form>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Category } from "@/types";
import { useTasks } from "@/composables/useTasks"; // Import the composable to get access to actions

// --- PROPS & EMITS ---
// Define the props the component accepts
const props = defineProps<{
  // The category to edit (if any). If null/undefined, it's in "create" mode.
  categoryToEdit?: Category | null;
}>();

// Define the events the component can emit to its parent
const emit = defineEmits([
  "close", // For closing the modal
  "category-created", // For the new auto-select feature
]);

// --- COMPONENT STATE ---
// Get the add/update actions from our composable
const { addCategory, updateCategory } = useTasks();

// A computed property to easily check if we are editing or creating
const isEditing = computed(() => !!props.categoryToEdit);

// A helper function to create a default category object for the form
const createDefaultCategory = (): Omit<Category, "id"> => ({
  name: "",
  color: "#4A90E2", // A nice default blue
});

// This ref holds the local state of the form (name and color)
const editableCategory = ref(createDefaultCategory());

// --- LOGIC ---
// This watcher syncs the form's state with the `categoryToEdit` prop.
// It runs immediately when the component is created.
watch(
  () => props.categoryToEdit,
  (newCategory) => {
    if (newCategory) {
      // If a category is passed in, copy its data into our local state for editing.
      editableCategory.value = { ...newCategory };
    } else {
      // If no category is passed, reset the form to the default state for creating.
      editableCategory.value = createDefaultCategory();
    }
  },
  { immediate: true }
);

// This function is called when the form is submitted
const handleSave = async () => {
  // Basic validation: ensure the name is not empty
  if (!editableCategory.value.name) {
    // You could add a toast notification here for better UX
    return;
  }

  if (isEditing.value && props.categoryToEdit) {
    // --- EDIT LOGIC ---
    // We are editing an existing category.
    await updateCategory({
      id: props.categoryToEdit.id,
      ...editableCategory.value,
    });
  } else {
    // --- CREATE LOGIC ---
    // We are creating a new category.
    const newCategory = await addCategory(editableCategory.value);

    // If the category was created successfully...
    if (newCategory) {
      // ...emit the new category object to the parent component.
      // This is the key for the auto-select feature.
      emit("category-created", newCategory);
    }
  }

  // After saving (either create or edit), close the modal.
  emit("close");
};
</script>

<style scoped>
/* Using the same modal styles for consistency */
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
  z-index: 1050; /* Higher than task editor */
}
.modal-content {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  width: 90%;
  max-width: 400px;
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
input[type="text"] {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 1rem;
}

.color-picker-group {
  display: flex;
  align-items: center;
  gap: 1rem;
}
input[type="color"] {
  width: 50px;
  height: 50px;
  padding: 0;
  border: none;
  cursor: pointer;
}
.color-preview {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid #eee;
}

.form-actions {
  margin-top: 2rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
