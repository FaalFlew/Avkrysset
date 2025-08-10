<!-- src/components/TemplateApplier.vue -->
<template>
  <div class="popover-overlay" @click.self="$emit('close')">
    <div class="popover-content">
      <div class="popover-header">
        <h4>Apply a Template</h4>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>
      <ul class="template-list">
        <li
          v-for="template in templates"
          :key="template.id"
          @click="applyTemplate(template)"
        >
          <span
            class="template-title"
            :style="{
              borderLeftColor: getCategory(template.categoryId)?.color,
            }"
          >
            {{ template.title }}
          </span>
          <span class="template-details"> {{ template.duration }}h </span>
        </li>
      </ul>
      <div class="popover-footer">
        <button
          class="btn-secondary full-width"
          @click="$emit('createNewTask')"
        >
          + Create New Blank Task
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTasks } from "@/composables/useTasks";
import { TaskTemplate } from "@/types";

const emit = defineEmits(["close", "createFromTemplate", "createNewTask"]);

const { templates, getCategory } = useTasks();

const applyTemplate = (template: TaskTemplate) => {
  emit("createFromTemplate", template);
};
</script>

<style scoped>
/* Using a fixed position overlay to allow clicking anywhere to close */
.popover-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1050; /* Above editor modal */
}

.popover-content {
  position: absolute; /* We will set top/left via style binding */
  width: 280px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
}

.popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #eee;
}

.popover-header h4 {
  margin: 0;
  font-size: 1rem;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  color: #888;
}

.template-list {
  list-style: none;
  padding: 0.5rem 0;
  margin: 0;
  max-height: 250px;
  overflow-y: auto;
}

.template-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background-color 0.2s;
}

.template-list li:hover {
  background-color: #f4f5f7;
}

.template-title {
  font-weight: 500;
  border-left: 4px solid #ccc;
  padding-left: 12px;
}

.template-details {
  color: #666;
  font-size: 0.9rem;
}

.popover-footer {
  padding: 0.75rem;
  border-top: 1px solid #eee;
}

.full-width {
  width: 100%;
}
</style>
