<template>
  <div class="template-manager-container">
    <div class="section">
      <h2>Task Templates</h2>
      <p>
        Create templates for tasks you do often. Then, click a time slot in the
        planner to apply them.
      </p>

      <div class="content-grid">
        <!-- Create New Template Form -->
        <div class="form-card">
          <h3>Create New Template</h3>
          <form @submit.prevent="handleSaveTemplate">
            <div class="form-group">
              <label for="template-title">Title</label>
              <input
                id="template-title"
                v-model="newTemplate.title"
                type="text"
                required
              />
            </div>
            <div class="form-group">
              <label for="template-duration">Duration (hours)</label>
              <input
                id="template-duration"
                v-model.number="newTemplate.duration"
                type="number"
                step="0.5"
                min="0.5"
                required
              />
            </div>
            <div class="form-group">
              <label for="template-category">Category</label>
              <select
                id="template-category"
                v-model="newTemplate.categoryId"
                @change="handleCategoryChange"
                required
              >
                <option disabled value="">Please select one</option>
                <option v-for="cat in categories" :key="cat.id" :value="cat.id">
                  {{ cat.name }}
                </option>
                <option value="_createNew">-- Create New Category --</option>
              </select>
            </div>
            <button type="submit" class="btn-primary">Add Template</button>
          </form>
        </div>

        <!-- List of Existing Templates -->
        <div class="list-card">
          <h3>Existing Templates</h3>
          <ul v-if="templates.length > 0" class="existing-templates-list">
            <li v-for="template in templates" :key="template.id">
              <span class="template-info">
                <span
                  class="template-title"
                  :style="{
                    borderLeftColor: getCategory(template.categoryId)?.color,
                  }"
                >
                  {{ template.title }}
                </span>
                <span class="template-details">
                  ({{ template.duration }}h,
                  {{ getCategory(template.categoryId)?.name }})
                </span>
              </span>
              <!-- UPDATED DELETE BUTTON -->
              <button
                @click="handleDeleteTemplate(template.id)"
                class="btn-danger"
              >
                Delete
              </button>
            </li>
          </ul>
          <p v-else>No templates created yet.</p>
        </div>
      </div>
    </div>

    <!-- CATEGORY MANAGEMENT SECTION -->
    <div class="section">
      <h2>Manage Categories</h2>
      <p>
        Edit or delete your custom categories. Deleting a category will
        re-assign its tasks to "Other".
      </p>
      <div class="category-list-card">
        <ul>
          <li v-for="category in categories" :key="category.id">
            <span class="category-info">
              <span
                class="category-color-dot"
                :style="{ backgroundColor: category.color }"
              ></span>
              <span class="category-name">{{ category.name }}</span>
            </span>
            <div
              v-if="category.id !== otherCategoryId"
              class="category-actions"
            >
              <button @click="editCategory(category)" class="btn-edit-small">
                Edit
              </button>
              <!-- UPDATED DELETE BUTTON -->
              <button
                @click="handleDeleteCategory(category.id)"
                class="btn-danger"
              >
                Delete
              </button>
            </div>
            <div v-else class="category-actions">
              <span class="default-tag">Default</span>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <CategoryEditor
      v-if="isCategoryEditorOpen"
      :category-to-edit="categoryToEdit"
      @close="closeCategoryEditor"
      @category-created="onCategoryCreated"
    />
  </Teleport>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { useTasks } from "@/composables/useTasks";
import { useUIStore } from "@/stores/uiStore";
import { Category } from "@/types";
import CategoryEditor from "./CategoryEditor.vue";

// --- COMPONENT STATE & ACTIONS ---
const {
  templates,
  categories,
  addTemplate,
  deleteTemplate,
  getCategory,
  deleteCategory: storeDeleteCategory, // Renamed to avoid conflict
  otherCategoryId,
} = useTasks();

const uiStore = useUIStore();

// State for the "Create New Template" form
const newTemplate = ref({
  title: "",
  duration: 1,
  categoryId: "", // Default to empty string for the "Please select" option
});

// State for the Category Editor modal
const isCategoryEditorOpen = ref(false);
const categoryToEdit = ref<Category | null>(null);

// --- METHODS ---

// Closes the category editor and resets its state
const closeCategoryEditor = () => {
  isCategoryEditorOpen.value = false;
  categoryToEdit.value = null;
};

// Opens the category editor in "edit" mode
const editCategory = (category: Category) => {
  categoryToEdit.value = category;
  isCategoryEditorOpen.value = true;
};

// Handles the logic for creating a new template from the form
const handleSaveTemplate = async () => {
  if (!newTemplate.value.title || !newTemplate.value.categoryId) return;
  // Await the async action
  await addTemplate(newTemplate.value);
  // Reset the form for the next entry
  newTemplate.value = { title: "", duration: 1, categoryId: "" };
};

// Handles deleting a template with confirmation
const handleDeleteTemplate = async (id: string) => {
  const confirmed = await uiStore.confirm(
    "Delete Template?",
    "Are you sure you want to delete this template? This action cannot be undone."
  );
  if (confirmed) {
    await deleteTemplate(id);
  }
};

// Handles deleting a category with confirmation
const handleDeleteCategory = async (id: string) => {
  const confirmed = await uiStore.confirm(
    "Delete Category?",
    'Are you sure you want to delete this category? All associated tasks and templates will be moved to the "Other" category.'
  );
  if (confirmed) {
    await storeDeleteCategory(id);
  }
};

// --- AUTO-SELECT CATEGORY LOGIC ---

// This is called when the category dropdown value changes
const handleCategoryChange = () => {
  if (newTemplate.value.categoryId === "_createNew") {
    // If "-- Create New --" is selected, open the editor
    categoryToEdit.value = null; // Ensure editor is in "create" mode
    isCategoryEditorOpen.value = true;
    // Reset the dropdown to the "Please select" option
    newTemplate.value.categoryId = "";
  }
};

// This is the new event handler that listens to the CategoryEditor
const onCategoryCreated = (newCategory: Category) => {
  // Automatically select the newly created category in the form's dropdown
  newTemplate.value.categoryId = newCategory.id;
  closeCategoryEditor(); // Close the modal
};
</script>

<style scoped>
/* --- STYLES ARE FIXED HERE --- */
.template-manager-container {
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 3rem;
}
.section h2 {
  margin-top: 0;
}
.content-grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 2rem;
  margin-top: 1rem;
}

@media (max-width: 768px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

.form-card,
.list-card,
.category-list-card {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.list-card h3,
.category-list-card h3 {
  margin-top: 0;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.5rem;
  margin-bottom: 1rem;
}

/* RESTORED: Existing Templates List Styles */
.existing-templates-list {
  list-style-type: none;
  padding: 0;
  margin: 0;
}
.existing-templates-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid #f0f0f0;
}
.existing-templates-list li:last-child {
  border-bottom: none;
}
.template-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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

/* Category List Styles */
.category-list-card ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.category-list-card li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid #f0f0f0;
}
.category-list-card li:last-child {
  border-bottom: none;
}
.category-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.category-color-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
}
.category-name {
  font-weight: 500;
}
.category-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.default-tag {
  font-size: 0.8rem;
  font-weight: bold;
  color: #666;
  background-color: #e0e0e0;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
}
.btn-edit-small {
  background: #f0f0f0;
  color: #555;
  border: 1px solid #ccc;
  padding: 0.3rem 0.8rem;
  font-size: 0.8rem;
  cursor: pointer;
}
.btn-danger-small {
  background: #e53e3e;
  color: white;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
}
.category-actions .btn-danger,
.existing-templates-list .btn-danger {
  padding: 0.3rem 0.8rem;
  font-size: 0.8rem;
}

.btn-edit-small {
  background: #f0f0f0;
  color: #555;
  border: 1px solid #ccc;
  padding: 0.3rem 0.8rem;
  font-size: 0.8rem;
  cursor: pointer;
  border-radius: 4px; /* Added for consistency */
}

/* Remove old circular button style */
.btn-danger-small {
  display: none;
}
</style>
