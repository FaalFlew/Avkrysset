<template>
  <div class="template-manager-container">
    <h2>Task Templates</h2>
    <p>
      Create templates for tasks you do often. Then, click a time slot in the
      planner to apply them.
    </p>

    <div class="content">
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
              required
            >
              <option disabled value="">Please select one</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">
                {{ cat.name }}
              </option>
            </select>
          </div>
          <button type="submit" class="btn-primary">Add Template</button>
        </form>
      </div>

      <div class="list-card">
        <h3>Existing Templates</h3>
        <ul v-if="templates.length > 0">
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
            <button
              @click="deleteTemplate(template.id)"
              class="btn-danger-small"
            >
              &times;
            </button>
          </li>
        </ul>
        <p v-else>No templates created yet.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useTasks } from "@/composables/useTasks";

const { templates, categories, addTemplate, deleteTemplate, getCategory } =
  useTasks();

const newTemplate = ref({
  title: "",
  duration: 1,
  categoryId: "",
});

const handleSaveTemplate = () => {
  if (!newTemplate.value.title || !newTemplate.value.categoryId) return;
  addTemplate(newTemplate.value);
  // Reset form
  newTemplate.value = { title: "", duration: 1, categoryId: "" };
};
</script>

<style scoped>
.template-manager-container {
  padding: 2rem;
}
.content {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 2rem;
  margin-top: 1rem;
}
.form-card,
.list-card {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
h3 {
  margin-top: 0;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.5rem;
  margin-bottom: 1rem;
}
ul {
  list-style-type: none;
  padding: 0;
}
li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid #f0f0f0;
}
li:last-child {
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
.btn-danger-small {
  background: #e53e3e;
  color: white;
  border: none;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-weight: bold;
}
@media (max-width: 768px) {
  .content {
    grid-template-columns: 1fr;
  }
}
</style>
