<!-- src/components/WeekView.vue -->
<template>
  <div class="week-view-container">
    <div class="calendar-controls">
      <button @click="previousWeek">&lt; Prev</button>
      <button @click="goToToday">Today</button>
      <button @click="nextWeek">Next &gt;</button>
      <h2>{{ weekRange }}</h2>
    </div>

    <div class="calendar-grid" ref="gridEl">
      <div class="time-labels">
        <div class="header-cell"></div>
        <div v-for="hour in 24" :key="hour" class="time-label">
          {{ formatHour(hour - 1) }}
        </div>
      </div>

      <div
        v-for="(day, dayIndex) in currentWeek"
        :key="day.toString()"
        class="day-column"
      >
        <div class="header-cell day-header">
          {{ day.format("ddd") }}
          <span class="day-number">{{ day.format("D") }}</span>
        </div>
        <div class="day-slots">
          <div
            v-for="hour in 24"
            :key="hour"
            class="time-slot"
            @click="handleSlotClick(day, hour - 1)"
          ></div>
        </div>

        <div
          v-for="task in getTasksForDay(day)"
          :key="task.id"
          class="task-block"
          :style="getTaskStyle(task)"
          @click="editTask(task)"
        >
          <div class="task-title">{{ task.title }}</div>
          <div class="task-time">{{ formatTaskTime(task) }}</div>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <TaskEditor
      v-if="isEditorOpen"
      :task-to-edit="selectedTask"
      :initial-date="selectedDate"
      @close="isEditorOpen = false"
      @save="onSaveTask"
      @delete="onDeleteTask"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useTasks } from "@/composables/useTasks";
import dayjs, { Dayjs } from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import { Task } from "@/types";
import TaskEditor from "./TaskEditor.vue";

dayjs.extend(isBetween);

const {
  currentWeek,
  tasksForCurrentWeek,
  previousWeek,
  nextWeek,
  goToToday,
  getCategory,
  addTask,
  updateTask,
  deleteTask,
} = useTasks();

const isEditorOpen = ref(false);
const selectedTask = ref<Task | null>(null);
const selectedDate = ref<string | undefined>(undefined);

const weekRange = computed(() => {
  const start = currentWeek.value[0];
  const end = currentWeek.value[6];
  if (start.isSame(end, "month")) {
    return start.format("MMMM YYYY");
  }
  return `${start.format("MMM D")} - ${end.format("MMM D, YYYY")}`;
});

const getTasksForDay = (day: Dayjs) => {
  return tasksForCurrentWeek.value.filter((task) =>
    dayjs(task.start).isSame(day, "day")
  );
};

const getTaskStyle = (task: Task) => {
  const startHour = dayjs(task.start).hour() + dayjs(task.start).minute() / 60;
  const category = getCategory(task.categoryId);

  return {
    top: `${startHour * 60}px`,
    height: `${task.duration * 60}px`,
    backgroundColor: category?.color || "#ccc",
  };
};

const formatHour = (hour: number) => {
  return dayjs().hour(hour).format("h A");
};

const formatTaskTime = (task: Task) => {
  const start = dayjs(task.start);
  const end = start.add(task.duration, "hour");
  return `${start.format("h:mm A")} - ${end.format("h:mm A")}`;
};

const editTask = (task: Task) => {
  selectedTask.value = task;
  selectedDate.value = undefined;
  isEditorOpen.value = true;
};

const handleSlotClick = (day: Dayjs, hour: number) => {
  selectedTask.value = null;
  selectedDate.value = day.hour(hour).minute(0).toISOString();
  isEditorOpen.value = true;
};

const onSaveTask = (taskData: Task) => {
  if (taskData.id) {
    updateTask(taskData);
  } else {
    const { id, ...newTaskData } = taskData;
    addTask(newTaskData);
  }
};

const onDeleteTask = (taskId: string) => {
  deleteTask(taskId);
};
</script>

<style scoped>
.week-view-container {
  padding: 1rem;
  background: #f9f9f9;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.calendar-controls {
  display: flex;
  align-items: center;
  margin-bottom: 1rem;
  gap: 0.5rem;
}
.calendar-controls h2 {
  margin: 0 1rem;
  font-weight: 500;
  min-width: 200px;
  text-align: center;
}

.calendar-grid {
  display: flex;
  flex-grow: 1;
  overflow-x: auto;
  border: 1px solid #ddd;
  background: #fff;
}

.time-labels {
  flex-basis: 80px;
  flex-shrink: 0;
  border-right: 1px solid #ddd;
}

.header-cell {
  height: 60px;
  border-bottom: 1px solid #ddd;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  background: #f7f7f7;
  position: sticky;
  top: 0;
  z-index: 10;
}

.day-header {
  flex-direction: column;
}
.day-number {
  font-size: 1.5rem;
  font-weight: 500;
}

.time-label {
  height: 60px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 2px;
  color: #777;
  font-size: 0.8rem;
  border-bottom: 1px dotted #eee;
}

.day-column {
  flex: 1;
  min-width: 120px;
  border-right: 1px solid #ddd;
  position: relative;
}
.day-column:last-child {
  border-right: none;
}
.day-slots {
  position: absolute;
  top: 60px;
  left: 0;
  right: 0;
  bottom: 0;
}
.time-slot {
  height: 60px;
  border-bottom: 1px solid #eee;
  cursor: pointer;
}
.time-slot:hover {
  background-color: rgba(68, 137, 233, 0.1);
}

.task-block {
  position: absolute;
  left: 5px;
  right: 5px;
  border-radius: 4px;
  padding: 0.5rem;
  color: white;
  overflow: hidden;
  cursor: pointer;
  z-index: 5;
  transition: background-color 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(0, 0, 0, 0.1);
}
.task-block:hover {
  filter: brightness(1.1);
}

.task-title {
  font-weight: bold;
  font-size: 0.9rem;
}
.task-time {
  font-size: 0.8rem;
  opacity: 0.8;
}
</style>
