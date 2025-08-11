<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <h3>{{ isEditing ? "Edit Task" : "Create Task" }}</h3>

      <form @submit.prevent="saveTask">
        <div class="form-group">
          <label for="title">Title</label>
          <input id="title" v-model="editableTask.title" type="text" required />
        </div>
        <div class="form-group">
          <label for="date">Date</label>
          <input id="date" v-model="datePart" type="date" required />
        </div>
        <div class="form-group">
          <label for="start-time">Start Time</label>
          <input id="start-time" v-model="timePart" type="time" required />
        </div>
        <div class="form-group">
          <label for="duration">Duration (hours)</label>
          <input
            id="duration"
            v-model.number="editableTask.duration"
            type="number"
            step="0.5"
            min="0.5"
            required
          />
        </div>
        <div class="form-group">
          <label for="category">Category</label>
          <select id="category" v-model="editableTask.categoryId" required>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">
              {{ cat.name }}
            </option>
          </select>
        </div>

        <div v-if="!isEditing" class="template-section">
          <h4 class="template-header">Or click a template to add instantly</h4>
          <ul class="template-list">
            <li
              v-for="template in templates"
              :key="template.id"
              @click="applyTemplateAndSave(template)"
            >
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
            </li>
          </ul>
        </div>

        <div class="form-actions">
          <button type="button" class="btn-secondary" @click="$emit('close')">
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
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useTaskStore } from "@/stores/taskStore";
import { useTasks } from "@/composables/useTasks";
import { storeToRefs } from "pinia";
import dayjs from "dayjs";
import { Task, TaskTemplate } from "@/types";

const props = defineProps<{
  taskToEdit?: Task | null;
  initialDate?: string;
}>();

const emit = defineEmits(["close", "save", "delete"]);

const store = useTaskStore();
const { categories } = storeToRefs(store);
const { templates, getCategory } = useTasks();

const isEditing = computed(() => !!props.taskToEdit);

const createDefaultTask = () => ({
  id: "",
  title: "",
  start: props.initialDate || dayjs().toISOString(),
  duration: 1,
  categoryId: categories.value[0]?.id || "",
});

const editableTask = ref<
  Omit<Task, "id"> & { id?: string; templateId?: string }
>(props.taskToEdit ? { ...props.taskToEdit } : createDefaultTask());

const datePart = ref(dayjs(editableTask.value.start).format("YYYY-MM-DD"));
const timePart = ref(dayjs(editableTask.value.start).format("HH:mm"));

const applyTemplateAndSave = (template: TaskTemplate) => {
  const startDateTime = dayjs(
    `${datePart.value}T${timePart.value}`
  ).toISOString();

  const finalTask = {
    title: template.title,
    duration: template.duration,
    categoryId: template.categoryId,
    templateId: template.id,
    start: startDateTime,
  };

  emit("save", finalTask);

  emit("close");
};

watch(
  () => props.taskToEdit,
  (newTask) => {
    if (newTask) {
      editableTask.value = { ...newTask };
      datePart.value = dayjs(newTask.start).format("YYYY-MM-DD");
      timePart.value = dayjs(newTask.start).format("HH:mm");
    } else {
      editableTask.value = createDefaultTask();
      datePart.value = dayjs(props.initialDate).format("YYYY-MM-DD");
      timePart.value = dayjs(props.initialDate).format("HH:mm");
    }
  }
);

const saveTask = () => {
  const startDateTime = dayjs(
    `${datePart.value}T${timePart.value}`
  ).toISOString();
  emit("save", { ...editableTask.value, start: startDateTime });
  emit("close");
};

const handleDelete = () => {
  if (props.taskToEdit?.id) {
    emit("delete", props.taskToEdit.id);
    emit("close");
  }
};
</script>

<style scoped>
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
</style>
