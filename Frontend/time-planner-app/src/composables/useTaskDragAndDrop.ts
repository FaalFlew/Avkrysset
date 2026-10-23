// src/composables/useTaskDragAndDrop.ts

import { ref, Ref } from "vue";
import { Task } from "@/types";
import { useTasks } from "./useTasks";
import dayjs, { Dayjs } from "dayjs";
const DATE_FORMAT = "YYYY-MM-DD HH:mm:ss"; // The original file used a different format, let's ensure consistency

export function useTaskDragAndDrop() {
  const { updateTask } = useTasks(); // removed 'tasks' as it wasn't used here

  const draggedTask = ref<Task | null>(null);
  const originalTaskState = ref<Task | null>(null);
  const resizeMode = ref<"top" | "bottom" | null>(null);
  const startY = ref(0);
  const startClientX = ref(0);
  const hasDragged = ref(false);

  const PIXELS_PER_HOUR = 60; // Assuming 1 hour = 60px, so 1px = 1 minute
  const SNAP_MINUTES = 15;

  // MODIFICATION: Changed function to be async for consistency.
  const onMouseDown = async (
    task: Task,
    event: MouseEvent,
    mode: "move" | "top" | "bottom" = "move"
  ) => {
    event.preventDefault();
    event.stopPropagation();

    originalTaskState.value = { ...task };
    draggedTask.value = { ...task };
    startY.value = event.clientY;
    startClientX.value = event.clientX;
    hasDragged.value = false;

    resizeMode.value = mode === "move" ? null : mode;

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // MODIFICATION: Changed function to be async for consistency.
  const onMouseMove = async (event: MouseEvent) => {
    if (!draggedTask.value || !originalTaskState.value) return;

    if (
      !hasDragged.value &&
      (Math.abs(event.clientY - startY.value) > 5 ||
        Math.abs(event.clientX - startClientX.value) > 5)
    ) {
      hasDragged.value = true;
    }

    const taskToUpdate = { ...draggedTask.value };
    const deltaY = event.clientY - startY.value;
    // MODIFICATION: Simplified pixel to minute conversion
    const minuteDelta =
      Math.round(deltaY / (PIXELS_PER_HOUR / 60) / SNAP_MINUTES) * SNAP_MINUTES;

    if (resizeMode.value === "bottom") {
      const originalDurationMinutes = originalTaskState.value.duration * 60;
      const newDurationMinutes = Math.max(
        SNAP_MINUTES,
        originalDurationMinutes + minuteDelta
      );
      taskToUpdate.duration = newDurationMinutes / 60;
    } else if (resizeMode.value === "top") {
      const originalStart = dayjs(originalTaskState.value.start);
      const newStart = originalStart.add(minuteDelta, "minute");
      const originalEnd = originalStart.add(
        originalTaskState.value.duration * 60,
        "minute"
      );
      const newDurationMinutes = originalEnd.diff(newStart, "minute");
      if (newDurationMinutes >= SNAP_MINUTES) {
        taskToUpdate.start = newStart.toISOString(); // Use ISOString for consistency with backend
        taskToUpdate.duration = newDurationMinutes / 60;
      }
    } else {
      // Move mode
      const originalStart = dayjs(originalTaskState.value.start);
      let newStart = originalStart.add(minuteDelta, "minute");

      const dayColumn = (event.target as HTMLElement).closest(
        ".day-column"
      ) as HTMLElement;
      if (dayColumn) {
        const dayColumnWidth = dayColumn.offsetWidth;
        const deltaX = event.clientX - startClientX.value;
        const dayDelta = Math.round(deltaX / dayColumnWidth);

        if (dayDelta !== 0) {
          newStart = originalStart
            .add(dayDelta, "day")
            .add(minuteDelta, "minute");
        }
      }
      taskToUpdate.start = newStart.toISOString(); // Use ISOString for consistency
    }

    draggedTask.value = taskToUpdate;
  };
  const onMouseUp = async () => {
    // MODIFICATION: onMouseUp is now async
    if (draggedTask.value && originalTaskState.value && hasDragged.value) {
      // MODIFICATION: Added await to the updateTask call
      const success = await updateTask(draggedTask.value, true);
      // If the update fails, the store shows an error, and since we never
      // changed the original data, clearing the ghost will revert the UI.
    }

    draggedTask.value = null;
    originalTaskState.value = null;
    resizeMode.value = null;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };

  return { onMouseDown, hasDragged, draggedTask };
}
