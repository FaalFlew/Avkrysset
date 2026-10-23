<!-- src/components/WeekView.vue -->
<template>
  <div class="calendar-grid-wrapper">
    <div class="calendar-header">
      <div class="header-cell time-header-cell"></div>
      <div
        v-for="day in currentWeek"
        :key="day.toString()"
        class="header-cell day-header"
      >
        {{ day.format("ddd") }}
        <span class="day-number">{{ day.format("D") }}</span>
      </div>
    </div>

    <div class="calendar-body">
      <div class="time-labels">
        <div v-for="hour in 24" :key="hour" class="time-label">
          {{ formatHour(hour - 1) }}
        </div>
      </div>

      <div class="days-container">
        <div class="background-grid">
          <div v-for="hour in 24" :key="hour" class="grid-hour-row"></div>
        </div>

        <div
          v-for="day in currentWeek"
          :key="day.toString()"
          class="day-column"
        >
          <div class="day-slots">
            <div
              v-for="hour in 24"
              :key="hour"
              class="time-slot"
              @click="handleSlotClick(day, hour - 1)"
            ></div>
          </div>

          <!-- THE FIX: We now loop over a computed property `getRenderableTasksForDay` -->
          <div
            v-for="task in getRenderableTasksForDay(day)"
            :key="task.id"
            class="task-block"
            :style="getTaskStyle(task)"
            @mousedown.prevent="onMouseDown(task, $event, 'move')"
            @mouseup="handleTaskClick(task)"
          >
            <div
              class="resize-handle top"
              @mousedown.stop="onMouseDown(task, $event, 'top')"
            ></div>
            <div class="task-content">
              <div class="task-title">{{ task.title }}</div>
              <div class="task-time">{{ formatTaskTime(task) }}</div>
            </div>
            <div
              class="resize-handle bottom"
              @mousedown.stop="onMouseDown(task, $event, 'bottom')"
            ></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <Teleport to="body">
    <TaskEditor
      v-if="isEditorOpen"
      :task-to-edit="selectedTask"
      :initial-date="selectedDate"
      @close="closeEditor"
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
import { useTaskDragAndDrop } from "@/composables/useTaskDragAndDrop";

dayjs.extend(isBetween);
const DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";

const { currentWeek, tasksForCurrentWeek, getCategory, deleteTask } =
  useTasks();
const { onMouseDown, hasDragged, draggedTask } = useTaskDragAndDrop();

const isEditorOpen = ref(false);
const selectedTask = ref<Task | null>(null);
const selectedDate = ref<string | undefined>(undefined);

// THE FIX: This new function intelligently merges the main task list with the "ghost" task
const getRenderableTasksForDay = (day: Dayjs) => {
  const tasksForDay = tasksForCurrentWeek.value.filter((task) =>
    dayjs(task.start, DATE_FORMAT).isSame(day, "day")
  );

  if (
    draggedTask.value &&
    dayjs(draggedTask.value.start, DATE_FORMAT).isSame(day, "day")
  ) {
    // If we are dragging a task on this day, filter out its "original" version
    // and replace it with the live "ghost" version.
    return [
      ...tasksForDay.filter((t) => t.id !== draggedTask.value!.id),
      draggedTask.value,
    ];
  }

  if (
    draggedTask.value &&
    !dayjs(draggedTask.value.start, DATE_FORMAT).isSame(day, "day")
  ) {
    // If we are dragging a task but it's not on this day, make sure to filter out the original
    return tasksForDay.filter((t) => t.id !== draggedTask.value!.id);
  }

  return tasksForDay;
};

const weekRange = computed(() => {
  const start = currentWeek.value[0];
  const end = currentWeek.value[6];
  if (start.isSame(end, "month")) return start.format("MMMM YYYY");
  return `${start.format("MMM D")} - ${end.format("MMM D, YYYY")}`;
});

const getTaskStyle = (task: Task) => {
  const start = dayjs(task.start, DATE_FORMAT);
  return {
    top: `${(start.hour() + start.minute() / 60) * 60}px`,
    height: `${task.duration * 60}px`,
    backgroundColor: getCategory(task.categoryId)?.color || "#ccc",
  };
};

const formatHour = (hour: number) => dayjs().hour(hour).format("h A");
const formatTaskTime = (task: Task) => {
  const start = dayjs(task.start, DATE_FORMAT);
  const end = start.add(task.duration, "hour");
  return `${start.format("h:mm A")} - ${end.format("h:mm A")}`;
};

const handleTaskClick = (task: Task) => {
  if (!hasDragged.value) {
    selectedTask.value = task;
    isEditorOpen.value = true;
  }
};
const closeEditor = () => {
  isEditorOpen.value = false;
  selectedTask.value = null;
};
const handleSlotClick = (day: Dayjs, hour: number) => {
  selectedTask.value = null;
  selectedDate.value = day.hour(hour).minute(0).format(DATE_FORMAT);
  isEditorOpen.value = true;
};
const onDeleteTask = (taskId: string) => {
  deleteTask(taskId);
  closeEditor();
};
</script>

<style scoped>
/* --- THE ONLY CHANGE IS HERE --- */

/* This is the key fix. By setting box-sizing, we ensure that borders
   are included *inside* the height calculation, not added to it.
   This guarantees perfect alignment. */
* {
  box-sizing: border-box;
}

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
  flex-shrink: 0;
}
.calendar-controls h2 {
  margin: 0 1rem;
  font-weight: 500;
}

.calendar-grid-wrapper {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #ddd;
  background: #fff;
}

/* Header Row Styles */
.calendar-header {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid #ddd;
}
.header-cell {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  background: #f7f7f7;
}
.time-header-cell {
  flex-basis: 80px;
  flex-grow: 0;
}
.day-header {
  min-width: 120px;
  height: 60px;
  flex-direction: column;
}
.day-number {
  font-size: 1.5rem;
  font-weight: 500;
}

/* Scrollable Body Styles */
.calendar-body {
  flex-grow: 1;
  display: flex;
  overflow-y: auto;
}
.time-labels {
  flex-basis: 80px;
  flex-shrink: 0;
  border-right: 1px solid #ddd;
}
.time-label {
  height: 60px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 2px;
  color: #777;
  font-size: 0.8rem;
  /* We add a border here to match the grid rows perfectly */
  border-bottom: 1px solid #eee;
}

/* Main Content Area Styles */
.days-container {
  flex-grow: 1;
  display: flex;
  position: relative;
}
.background-grid {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  grid-template-rows: repeat(24, 60px);
  pointer-events: none;
}
.grid-hour-row {
  border-bottom: 1px solid #eee;
}

/* Day Column & Layering Styles */
.day-column {
  flex: 1;
  min-width: 120px;
  border-right: 1px solid #ddd;
  position: relative;
  height: 1440px; /* 24 * 60 */
}
.day-column:last-child {
  border-right: none;
}

.day-slots {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1; /* Slots are at the bottom layer, ready to be clicked */
}
.time-slot {
  height: 60px;
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
  z-index: 2; /* Tasks are rendered on top of the slots */
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
.task-block {
  /* Add cursor for moving */
  cursor: grab;
  display: flex; /* New for content centering */
  flex-direction: column; /* New */
}
.task-block:active {
  cursor: grabbing;
  opacity: 0.8;
  z-index: 10;
}

.task-content {
  flex-grow: 1;
  padding: 0.5rem;
}

.resize-handle {
  position: absolute;
  left: 0;
  right: 0;
  height: 8px;
  z-index: 20; /* Above the task block */
}
.resize-handle.top {
  top: 0;
  cursor: n-resize;
}
.resize-handle.bottom {
  bottom: 0;
  cursor: s-resize;
}

.task-block {
  cursor: grab;
  display: flex;
  flex-direction: column;
}
.task-block:active {
  cursor: grabbing;
  opacity: 0.8;
  z-index: 10;
}
.task-content {
  flex-grow: 1;
  padding: 0.5rem;
}
.resize-handle {
  position: absolute;
  left: 0;
  right: 0;
  height: 8px;
  z-index: 20;
}
.resize-handle.top {
  top: 0;
  cursor: n-resize;
}
.resize-handle.bottom {
  bottom: 0;
  cursor: s-resize;
}
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
  flex-shrink: 0;
  padding: 0 1rem;
}
.calendar-controls h2 {
  margin: 0 1rem;
  font-weight: 500;
}

.calendar-grid-wrapper {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #ddd;
  background: #fff;
}

.calendar-header {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid #ddd;
}
.header-cell {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  background: #f7f7f7;
}
.time-header-cell {
  flex-basis: 80px;
  flex-grow: 0;
}
.day-header {
  min-width: 120px;
  height: 60px;
  flex-direction: column;
}
.day-number {
  font-size: 1.5rem;
  font-weight: 500;
}

.calendar-body {
  flex-grow: 1;
  display: flex;
  /* This allows the main grid to scroll horizontally */
  overflow-x: auto;
  /* We keep vertical scroll on the parent for the sticky header effect */
  overflow-y: auto;
}

.time-labels {
  flex-basis: 80px;
  flex-shrink: 0;
  border-right: 1px solid #ddd;
  /* --- FIX for Horizontal Scroll Sync --- */
  position: sticky;
  left: 0;
  z-index: 30; /* Higher than task blocks */
  background-color: #fff; /* Prevents content from showing through during scroll */
}
.time-label {
  height: 60px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 2px;
  color: #777;
  font-size: 0.8rem;
  border-bottom: 1px solid #eee;
  box-sizing: border-box;
}

.days-container {
  flex-grow: 1;
  display: flex;
  position: relative;
}
.background-grid {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: grid;
  grid-template-rows: repeat(24, 60px);
  pointer-events: none;
}
.grid-hour-row {
  border-bottom: 1px solid #eee;
  box-sizing: border-box;
}

.day-column {
  flex: 1;
  min-width: 120px;
  border-right: 1px solid #ddd;
  position: relative;
  height: 1440px;
}
.day-column:last-child {
  border-right: none;
}
.day-slots {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
}
.time-slot {
  height: 60px;
  cursor: pointer;
  box-sizing: border-box;
}
.time-slot:hover {
  background-color: rgba(68, 137, 233, 0.1);
}

/* --- NEW: Media Query for Mobile Responsiveness --- */
@media (max-width: 768px) {
  .week-view-container {
    padding: 0; /* Remove padding for edge-to-edge view */
  }

  .calendar-controls {
    padding: 0.5rem;
    flex-wrap: wrap; /* Allow controls to stack */
    justify-content: center;
  }

  /* FIX for Control Sizing */
  .calendar-controls h2 {
    order: -1; /* Move the date range to the top */
    width: 100%;
    text-align: center;
    font-size: 1.1rem; /* Smaller font size */
    margin-bottom: 0.5rem;
  }
  .calendar-controls button {
    padding: 0.4rem 0.8rem; /* Smaller buttons */
    font-size: 0.8rem;
  }

  .time-labels {
    flex-basis: 60px; /* Tighter time column */
    font-size: 0.7rem;
  }
  .time-header-cell {
    flex-basis: 60px;
  }
  .day-column {
    min-width: 100px; /* Allow columns to be a bit narrower */
  }
}
</style>
