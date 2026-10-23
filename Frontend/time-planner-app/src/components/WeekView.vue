<!-- src/components/WeekView.vue -->
<script setup lang="ts">
/**
 * WeekView — the planner grid: one scroll container holding a CSS grid with a sticky corner,
 * sticky day headers, a sticky time gutter and N day columns (7 on ≥ 768px, 1 on phones), so
 * headers and columns can never misalign.
 *
 * Interactions
 * - Click empty space: draft at that quarter-hour (1h). Press-drag: draft over the dragged range
 *   (15-min snap). Touch tap: draft floored to 30 min. The global editor opens anchored to it.
 * - Task blocks: click/Enter edits; drag moves (long-press on touch); edges resize (fine
 *   pointers); keyboard ↑/↓ ±15 min, Shift+↑/↓ end ±15 min, ←/→ ±1 day, PageUp/PageDown ±1
 *   week, Delete removes.
 * - Cross-week: holding a dragged task at the left/right edge emits `advance` (the planner shows
 *   the previous/next week, or day on phones); keyboard day/week moves off the visible days and
 *   cancelled drags emit `navigate` with the day to show. Columns are keyed by position, and the
 *   dragged task's own node stays mounted (invisible "anchor") while another week is shown.
 * - Moves are announced through the polite live region (uiStore.announce).
 * Emits: navigate(day), advance(side)
 * Exposes: scrollToNow(smooth), autoScroll(smooth, force)
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Task } from "@/types";
import TaskBlock from "@/components/planner/TaskBlock.vue";
import NowIndicator from "@/components/planner/NowIndicator.vue";
import { blockExtent, layoutLanes, type LanePlacement } from "@/components/planner/laneLayout";
import {
  canDeleteTask,
  canEditTask,
  isOrgTask,
  managedMessage,
  organizationLabel,
  overlapMessage,
} from "@/lib/taskAccess";
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import { hasOpenOverlay } from "@/components/ui/dialogStack";
import {
  abortSwipe,
  endSwipe,
  moveSwipe,
  outcomeSide,
  startSwipe,
  swipeOffset,
  type SwipeState,
} from "@/components/planner/daySwipe";
import {
  HOUR_HEIGHT,
  MINUTES_PER_DAY,
  PX_PER_MINUTE,
  SNAP_MINUTES,
  TOUCH_SNAP_MINUTES,
} from "@/components/planner/gridConstants";
import {
  findConflict,
  useKeyboardTaskMoves,
  useTaskDragAndDrop,
  type DragMode,
  type KeyboardMove,
} from "@/composables/useTaskDragAndDrop";
import { useTaskEditor } from "@/composables/useTaskEditor";
import { useBreakpoint } from "@/composables/useMediaQuery";
import { useNow, useToday } from "@/composables/useClock";
import { useTaskStore } from "@/stores/taskStore";
import { useUIStore } from "@/stores/uiStore";
import {
  addDays,
  atMinutesOfDay,
  compareInstants,
  formatDayOfMonth,
  formatHourLabel,
  formatTimeOfDay,
  isInRange,
  minutesSinceStartOfDay,
  startOfDayInstant,
  toDateKey,
  isoWeekday,
  type DateKey,
} from "@/lib/datetime";
import {
  displayTitle,
  formatDayGroupLabel,
  formatEdgeTargetLabel,
  formatGridCornerOffset,
  formatGridRegionLabel,
  formatHoursCompact,
  formatMoveAnnouncement,
  formatSlotAnnouncement,
  formatWeekdayMicro,
} from "@/lib/plannerFormat";
import { OTHER_COLOR } from "@/lib/categoryPalette";

const props = withDefaults(
  defineProps<{
    /** Visible days in column order. */
    days: readonly DateKey[];
    /** The week is loading (aria-busy). */
    busy?: boolean;
  }>(),
  { busy: false }
);

const emit = defineEmits<{
  /** Show this day (its week on ≥ 768px): keyboard moves across weeks, cancelled drags. */
  navigate: [day: DateKey];
  /** Show the previous (-1) / next (+1) week (day on phones) while a dragged task is held at an edge. */
  advance: [side: -1 | 1];
}>();

const taskStore = useTaskStore();
const uiStore = useUIStore();
const editor = useTaskEditor();
const { isCoarse, prefersReducedMotion } = useBreakpoint();
const today = useToday();
const now = useNow();

const scroller = ref<HTMLElement | null>(null);
const columnEls = ref<HTMLElement[]>([]);
const columnWidth = ref(140);
const DAYHEAD_PX = 56;
const hintId = "planner-task-hint";
const readOnlyHintId = "planner-task-hint-readonly";

const isSingleDay = computed(() => props.days.length === 1);
const hours = Array.from({ length: 24 }, (_, h) => h);

function setColumnRef(el: unknown, index: number): void {
  if (el instanceof HTMLElement) columnEls.value[index] = el;
}

// ------------------------------------------------------------------ data
const visibleRange = computed(() => {
  const first = props.days[0]!;
  const last = props.days[props.days.length - 1]!;
  return { start: startOfDayInstant(first), end: startOfDayInstant(addDays(last, 1)) };
});

const visibleTasks = computed(() => taskStore.tasks.filter((t) => isInRange(t.start, visibleRange.value)));

function categoryOf(task: Pick<Task, "categoryId" | "categoryColor" | "categoryName">) {
  const category = taskStore.getCategoryById(task.categoryId);
  return {
    color: category?.color ?? task.categoryColor ?? OTHER_COLOR,
    name: category?.name ?? task.categoryName,
  };
}

// ------------------------------------------------------------------ fresh highlight
const freshId = ref<string | null>(null);
let freshTimer: number | undefined;
function flash(id: string): void {
  freshId.value = id;
  window.clearTimeout(freshTimer);
  freshTimer = window.setTimeout(() => {
    freshId.value = null;
  }, 700);
}
watch(
  () => editor.lastSavedTaskId.value,
  (id) => {
    if (!id) return;
    flash(id);
    focusSavedTaskWhenEditorGone(id);
  }
);

/**
 * After the editor closes, keyboard focus would otherwise be lost (e.g. opened with N, the title
 * input disappears with the dialog's leave transition): once the dialog is gone, put focus on the
 * saved task so arrows/Enter work right away — unless focus went back to a real opener.
 */
function focusSavedTaskWhenEditorGone(id: string): void {
  const startedAt = performance.now();
  const check = () => {
    if (document.querySelector(".ui-dialog") && performance.now() - startedAt < 1000) {
      requestAnimationFrame(check);
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body || active.closest(".ui-dialog")) {
      scroller.value?.querySelector<HTMLElement>(`[data-task-id="${id}"]`)?.focus({ preventScroll: false });
    }
  };
  requestAnimationFrame(check);
}

// ------------------------------------------------------------------ drag / keyboard
/** The task's original day is no longer on screen (it moved to another week, or day on phones). */
function leftTheView(original: Pick<Task, "start">): boolean {
  return !props.days.includes(toDateKey(original.start));
}

async function commitMove(task: Task, original: Task, mode: DragMode = "move"): Promise<boolean> {
  const hadFocus = document.activeElement?.closest?.(`[data-task-id="${task.id}"]`) !== null;
  const crossed = leftTheView(original);
  // Cross-week moves get a "Moved to Monday, October 12" toast with Undo (it also announces).
  const ok = await taskStore.moveTask(task, original, {
    announceDestination: crossed,
    // The server rejected the change as invalid (e.g. a legacy 30h duration): offer the editor.
    errorAction: { label: "Edit", onClick: () => editor.openEdit(original) },
  });
  if (ok) {
    if (!crossed) uiStore.announce(formatMoveAnnouncement(task, mode === "move" ? "Moved" : "Resized"));
    flash(task.id);
    if (hadFocus) refocusTask(task.id);
  }
  return ok;
}

function onConflict(task: Task, other?: Task): void {
  // An assigned org task is named the way the server would ("…assigned to you in Acme.").
  const message = overlapMessage(other);
  uiStore.showToast(message, "error");
  uiStore.announce(`${displayTitle(task.title, "Task")} was not moved: ${message}`);
}

/**
 * Feedback when someone tries to move a read-only org task (keyboard or drag): one toast per
 * burst — holding an arrow key or wiggling the pointer doesn't re-show it while it's up. The
 * toast's own live region announces it.
 */
function notifyReadOnly(task: Task): void {
  const message = managedMessage(task);
  if (uiStore.toast.isVisible && uiStore.toast.message === message) return;
  uiStore.showToast(message, "info", 3000);
}

// Automatic scrolling (week change, data arriving) must not move the grid under a drag in
// progress, nor right after one that navigated (the user should see the task where they left it).
let autoScrollHeldUntil = 0;
function holdAutoScroll(ms = 800): void {
  autoScrollHeldUntil = performance.now() + ms;
}

const drag = useTaskDragAndDrop({
  scroller,
  columns: () => columnEls.value.slice(0, props.days.length),
  days: () => props.days,
  topInset: () => DAYHEAD_PX,
  leftInset: () => (scroller.value ? parseFloat(getComputedStyle(scroller.value).getPropertyValue("--gutter-w")) || 56 : 56),
  tasks: () => taskStore.tasks,
  commit: commitMove,
  onConflict,
  isLoading: () => taskStore.isLoadingWeek,
  onEdgeAdvance: (side) => emit("advance", side),
  // Org tasks an admin assigned to me are read-only (Q1): no drag, resize or long-press.
  canDrag: (task) => canEditTask(task),
  onDragBlocked: notifyReadOnly,
  onCancel: (original) => {
    holdAutoScroll();
    uiStore.announce("Move cancelled.");
    // Show the task back in place.
    if (leftTheView(original)) emit("navigate", toDateKey(original.start));
  },
});

/** Keyboard moves that leave the view: show the new day; a failed/conflicting one returns. */
function returnToOriginal(id: string): void {
  const original = taskStore.getTaskById(id);
  if (original && leftTheView(original)) {
    holdAutoScroll();
    emit("navigate", toDateKey(original.start));
    refocusTask(id);
  }
}

const keyboard = useKeyboardTaskMoves({
  days: () => props.days,
  tasks: () => taskStore.tasks,
  commit: async (task, original) => {
    const ok = await commitMove(task, original, "move");
    if (!ok) returnToOriginal(task.id);
    return ok;
  },
  onConflict: (task, other) => {
    onConflict(task, other);
    returnToOriginal(task.id);
  },
  onStep: (task) => uiStore.announce(formatSlotAnnouncement(task)),
  canMove: (task) => canEditTask(task),
  onBlocked: notifyReadOnly,
  onNavigate: (day) => {
    holdAutoScroll();
    emit("navigate", day);
  },
});

// Announce the week (day) shown while a dragged task is held at the edge.
watch(
  () => props.days.join(","),
  () => {
    if (drag.dragTaskId.value) uiStore.announce(`Showing ${formatGridRegionLabel(props.days)}`);
  }
);

// Focus requests (e.g. Undo of a cross-week move navigated back): focus the task once it renders,
// but only when focus was lost (body, or the toast that just closed) — never steal it.
watch(
  () => uiStore.taskFocusRequest,
  (id) => {
    if (!id) return;
    uiStore.taskFocusRequest = null;
    focusTaskWhenRendered(id);
  }
);

function focusTaskWhenRendered(id: string, tries = 12): void {
  void nextTick(() => {
    const el = scroller.value?.querySelector<HTMLElement>(`button[data-task-id="${id}"]`);
    const active = document.activeElement as HTMLElement | null;
    const lost = !active || active === document.body || !!active.closest(".toast-region");
    if (el) {
      if (lost) el.focus({ preventScroll: false });
      return;
    }
    if (tries > 0) window.setTimeout(() => focusTaskWhenRendered(id, tries - 1), 50);
  });
}

function refocusTask(id: string): void {
  void nextTick(() => {
    const el = scroller.value?.querySelector<HTMLElement>(`button[data-task-id="${id}"]`);
    el?.focus({ preventScroll: false });
  });
}

// ------------------------------------------------------------------ render model
interface RenderItem {
  key: string;
  task: Task;
  variant: "task" | "ghost" | "placeholder" | "anchor";
  saving: boolean;
  conflict: boolean;
  /** Side-by-side lane among overlapping blocks (tasks and placeholders). */
  placement?: LanePlacement;
}

const itemsByDay = computed(() => {
  const map = new Map<DateKey, RenderItem[]>();
  for (const day of props.days) map.set(day, []);
  const push = (item: RenderItem) => map.get(toDateKey(item.task.start))?.push(item);

  const ghost = drag.ghost.value;
  const dragId = ghost ? drag.dragTaskId.value : null;
  const overrides = keyboard.overrides.value;
  const savingIds = keyboard.savingIds.value;

  const seen = new Set<string>();
  for (const task of taskStore.tasks) {
    seen.add(task.id);
    if (task.id === dragId) continue;
    const override = overrides[task.id];
    const shown = override ?? task;
    const conflict = !!override && !!findConflict(shown, taskStore.tasks);
    push({ key: task.id, task: shown, variant: "task", saving: !!savingIds[task.id], conflict });
  }
  // A keyboard move into another week: once that week loads, the task may not be in the list.
  for (const [id, shown] of Object.entries(overrides)) {
    if (seen.has(id) || id === dragId) continue;
    push({ key: id, task: shown, variant: "task", saving: !!savingIds[id], conflict: !!findConflict(shown, taskStore.tasks) });
  }

  // The dragged task: the ghost at the pointer, plus its own node — a dashed placeholder where it
  // was, or (when that day is off screen) an invisible anchor kept in its original column so a
  // touch drag never loses the element it started on.
  if (dragId && ghost) {
    if (drag.isSaving.value) {
      push({ key: dragId, task: ghost, variant: "task", saving: true, conflict: false });
    } else {
      const origin = drag.dragOrigin.value;
      if (origin) {
        const base = { key: dragId, task: origin.task, saving: false, conflict: false };
        const originList = map.get(toDateKey(origin.task.start));
        if (originList) originList.push({ ...base, variant: "placeholder" });
        else {
          const column = props.days[Math.min(origin.columnIndex, props.days.length - 1)] ?? props.days[0]!;
          map.get(column)?.push({ ...base, variant: "anchor" });
        }
      }
      push({ key: `${dragId}~ghost`, task: ghost, variant: "ghost", saving: false, conflict: drag.conflict.value });
    }
  }

  // Overlapping blocks share the column in lanes (org tasks may overlap personal ones, Q3).
  // The ghost floats above at full width; the invisible anchor takes no space.
  for (const list of map.values()) {
    const laned = list.filter((i) => i.variant === "task" || i.variant === "placeholder");
    const placements = layoutLanes(
      laned.map((i) => {
        const extent = blockExtent(i.task.start, i.task.duration);
        return { id: i.key, top: extent.top, bottom: extent.top + extent.height };
      })
    );
    for (const item of laned) item.placement = placements.get(item.key);
    // Chronological order inside each day = chronological tab order (left lane first on ties).
    list.sort(
      (a, b) =>
        compareInstants(a.task.start, b.task.start) || (a.placement?.lane ?? 0) - (b.placement?.lane ?? 0)
    );
  }
  return map;
});

const edgeCue = computed(() => drag.edge.value);
const edgeLabel = computed(() => (edgeCue.value ? formatEdgeTargetLabel(props.days, edgeCue.value.side) : ""));

const dayStats = computed(() => {
  const stats = new Map<DateKey, { count: number; hours: number }>();
  for (const day of props.days) {
    const items = (itemsByDay.value.get(day) ?? []).filter((i) => i.variant !== "ghost" && i.variant !== "anchor");
    stats.set(day, { count: items.length, hours: items.reduce((sum, i) => sum + i.task.duration, 0) });
  }
  return stats;
});

/** Draft block (task being created in the editor, or a press-drag in progress). */
const draftBlock = computed(() => {
  if (creating.value?.active) {
    const c = creating.value;
    return {
      day: c.day,
      task: {
        id: "draft",
        title: "",
        start: atMinutesOfDay(c.day, c.from),
        duration: (c.to - c.from) / 60,
      },
    };
  }
  if (!editor.state.open || editor.state.mode !== "create" || !editor.draft.start) return null;
  if (!isInRange(editor.draft.start, visibleRange.value)) return null;
  return {
    day: toDateKey(editor.draft.start),
    task: { id: "draft", title: editor.draft.title, start: editor.draft.start, duration: editor.draft.durationH || 1 },
  };
});

const showNow = computed(() => props.days.includes(today.value));
const cornerLabel = computed(() => formatGridCornerOffset(now.value));
const regionLabel = computed(() => formatGridRegionLabel(props.days));
const keyboardHint = computed(() =>
  isSingleDay.value
    ? "Enter to edit. Up and down arrows move 15 minutes, left and right arrows move a day, Page Up and Page Down move a week, Shift plus up or down resizes, Delete removes."
    : "Enter to edit. Arrow keys move, Page Up and Page Down move a week, Shift plus up or down resizes, Delete removes."
);

// ------------------------------------------------------------------ hover preview + create
const canHover = computed(() => !isCoarse.value);
const hover = ref<{ day: DateKey; minutes: number } | null>(null);

interface CreateState {
  day: DateKey;
  index: number;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  anchor: number;
  from: number;
  to: number;
  active: boolean;
}
const creating = ref<CreateState | null>(null);

function minutesAt(index: number, clientY: number, step: number): number {
  const column = columnEls.value[index];
  if (!column) return 0;
  const y = clientY - column.getBoundingClientRect().top;
  const minutes = Math.floor(y / PX_PER_MINUTE / step) * step;
  return Math.min(Math.max(minutes, 0), MINUTES_PER_DAY - step);
}

function isEmptySpace(event: Event): boolean {
  const target = event.target as HTMLElement | null;
  return !!target && !target.closest(".task-block");
}

function onColumnPointerMove(event: PointerEvent, day: DateKey, index: number): void {
  if (!canHover.value || event.pointerType !== "mouse") return;
  if (creating.value || drag.dragTaskId.value || editor.state.open || !isEmptySpace(event)) {
    hover.value = null;
    return;
  }
  const minutes = minutesAt(index, event.clientY, SNAP_MINUTES);
  if (hover.value?.day !== day || hover.value.minutes !== minutes) hover.value = { day, minutes };
}

function onColumnPointerLeave(): void {
  hover.value = null;
}

function onColumnPointerDown(event: PointerEvent, day: DateKey, index: number): void {
  if (!isEmptySpace(event) || drag.dragTaskId.value || creating.value) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (!event.isPrimary) return;
  const isTouch = event.pointerType === "touch";
  const anchor = minutesAt(index, event.clientY, isTouch ? TOUCH_SNAP_MINUTES : SNAP_MINUTES);
  if (!isTouch) event.preventDefault(); // no text selection while drag-creating
  creating.value = {
    day,
    index,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    startX: event.clientX,
    startY: event.clientY,
    anchor,
    from: anchor,
    to: anchor + 60,
    active: false,
  };
  window.addEventListener("pointermove", onCreateMove);
  window.addEventListener("pointerup", onCreateUp);
  window.addEventListener("pointercancel", onCreateCancel);
}

function onCreateMove(event: PointerEvent): void {
  const c = creating.value;
  if (!c || event.pointerId !== c.pointerId) return;
  const distance = Math.hypot(event.clientX - c.startX, event.clientY - c.startY);
  if (c.pointerType === "touch") {
    if (distance > 10) stopCreate(); // scrolling, not tapping
    return;
  }
  if (!c.active && distance < 4) return;
  c.active = true;
  hover.value = null;
  const current = minutesAt(c.index, event.clientY, SNAP_MINUTES);
  c.from = Math.min(c.anchor, current);
  c.to = Math.max(c.anchor, current) + SNAP_MINUTES;
}

function onCreateUp(event: PointerEvent): void {
  const c = creating.value;
  if (!c || event.pointerId !== c.pointerId) return;
  stopCreate();
  const from = c.active ? c.from : c.anchor;
  const durationMinutes = c.active ? c.to - c.from : 60;
  openDraft(c.day, c.index, from, durationMinutes);
}

function onCreateCancel(): void {
  stopCreate();
}

function stopCreate(): void {
  window.removeEventListener("pointermove", onCreateMove);
  window.removeEventListener("pointerup", onCreateUp);
  window.removeEventListener("pointercancel", onCreateCancel);
  creating.value = null;
}

function openDraft(day: DateKey, index: number, fromMinutes: number, durationMinutes: number): void {
  const column = columnEls.value[index];
  const rect = column?.getBoundingClientRect();
  const anchorRect = rect
    ? {
        left: rect.left + 2,
        right: rect.right - 6,
        width: rect.width - 8,
        top: rect.top + fromMinutes * PX_PER_MINUTE,
        bottom: rect.top + (fromMinutes + durationMinutes) * PX_PER_MINUTE,
        height: durationMinutes * PX_PER_MINUTE,
      }
    : null;
  hover.value = null;
  editor.openCreate({ start: atMinutesOfDay(day, fromMinutes), durationH: durationMinutes / 60, anchorRect });
}

// ------------------------------------------------------------------ task block events
function onTaskPress(task: Task, event: PointerEvent, mode: DragMode): void {
  hover.value = null;
  drag.onPointerDown(task, event, mode);
}

function onTaskActivate(task: Task, event: MouseEvent): void {
  if (drag.consumeClickSuppression()) return;
  keyboard.flush(task.id);
  const shown = keyboard.overrides.value[task.id] ?? task;
  const target = event.currentTarget as HTMLElement | null;
  editor.openEdit(shown, target?.getBoundingClientRect() ?? null);
}

function onTaskKeydown(task: Task, event: KeyboardEvent): void {
  // Read-only org tasks (Q1): Enter/Space still open the read-only view; moving, resizing and
  // deleting are refused with an explanation (the store toasts on Delete).
  if (!canEditTask(task) && !event.altKey && !event.ctrlKey && !event.metaKey) {
    const blocked = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"];
    if (blocked.includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      notifyReadOnly(task);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      void taskStore.deleteTask(task.id); // refuses with a toast ("This task is managed in Acme.")
      return;
    }
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  let move: KeyboardMove | null = null;
  switch (event.key) {
    case "ArrowUp":
      move = event.shiftKey ? "shorter" : "earlier";
      break;
    case "ArrowDown":
      move = event.shiftKey ? "longer" : "later";
      break;
    // Day/week moves cross week boundaries: the view follows the task (keyboardTargetDay).
    case "ArrowLeft":
      move = "prevDay";
      break;
    case "ArrowRight":
      move = "nextDay";
      break;
    case "PageUp":
      move = "prevWeek";
      break;
    case "PageDown":
      move = "nextWeek";
      break;
    case "Delete":
    case "Backspace":
      event.preventDefault();
      event.stopPropagation();
      deleteFocused(task);
      return;
    case "Escape":
      event.preventDefault();
      (event.currentTarget as HTMLElement | null)?.blur();
      scroller.value?.focus({ preventScroll: true });
      return;
    default:
      return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (!move) return;
  const dayBefore = toDateKey((keyboard.overrides.value[task.id] ?? task).start);
  if (keyboard.step(task, move)) {
    const after = keyboard.overrides.value[task.id];
    if (after && toDateKey(after.start) !== dayBefore) refocusTask(task.id);
    else void nextTick(() => scroller.value?.querySelector<HTMLElement>(`button[data-task-id="${task.id}"]`)?.scrollIntoView({ block: "nearest" }));
  }
}

function deleteFocused(task: Task): void {
  // Not mine to delete (org task): the store refuses with a toast; focus stays put.
  if (!canDeleteTask(task)) {
    void taskStore.deleteTask(task.id);
    return;
  }
  // Move focus to a neighbouring block (or the grid) before the block disappears.
  const blocks = Array.from(scroller.value?.querySelectorAll<HTMLElement>("button.task-block") ?? []);
  const index = blocks.findIndex((b) => b.dataset.taskId === task.id);
  const neighbour = blocks[index + 1] ?? blocks[index - 1];
  void taskStore.deleteTask(task.id);
  void nextTick(() => {
    if (neighbour?.isConnected) neighbour.focus();
    else scroller.value?.focus({ preventScroll: true });
  });
}

// ------------------------------------------------------------------ scrolling
let lastProgrammaticTop: number | null = null;

function scrollTo(top: number, smooth: boolean): void {
  const el = scroller.value;
  if (!el) return;
  const max = el.scrollHeight - el.clientHeight;
  const clamped = Math.max(0, Math.min(top, max));
  lastProgrammaticTop = clamped;
  el.scrollTo({ top: clamped, behavior: smooth && !prefersReducedMotion.value ? "smooth" : "auto" });
}

/**
 * Today visible: now line at 1/3 of the viewport; otherwise min(08:00, first task − 30m).
 * Automatic calls (week change, data arriving) stand down during/just after a drag that
 * navigated and while a task block has keyboard focus; `force` (the Today button) always scrolls.
 */
function autoScroll(smooth = false, force = false): void {
  const el = scroller.value;
  if (!el) return;
  if (!force) {
    if (drag.dragTaskId.value || performance.now() < autoScrollHeldUntil) return;
    if ((document.activeElement as HTMLElement | null)?.closest?.("button.task-block")) return;
  }
  const visibleHeight = el.clientHeight - DAYHEAD_PX;
  if (showNow.value) {
    scrollTo(minutesSinceStartOfDay(now.value) * PX_PER_MINUTE - visibleHeight / 3, smooth);
    return;
  }
  let target = 8 * 60;
  for (const task of visibleTasks.value) target = Math.min(target, minutesSinceStartOfDay(task.start) - 30);
  scrollTo(Math.max(0, target) * PX_PER_MINUTE, smooth);
}

function scrollToNow(smooth = true): void {
  void nextTick(() => autoScroll(smooth, true));
}

// Re-run the initial scroll once the week's tasks arrive, unless the user has scrolled.
watch(
  () => props.busy,
  (busy) => {
    if (busy) return;
    const el = scroller.value;
    if (el && lastProgrammaticTop !== null && Math.abs(el.scrollTop - lastProgrammaticTop) < 2) {
      void nextTick(() => autoScroll(false));
    }
  }
);

// ------------------------------------------------------------------ layout measuring
let resizeObserver: ResizeObserver | null = null;
let observedColumn: HTMLElement | null = null;

function measureColumns(): void {
  const first = columnEls.value[0];
  if (first) columnWidth.value = first.getBoundingClientRect().width;
}

onMounted(() => {
  autoScroll(false);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(measureColumns);
    if (scroller.value) resizeObserver.observe(scroller.value);
  }
  measureColumns();
});

// Observe the first day column itself: it can render after mount (data/loading states), and its
// width also changes without the scroller resizing (e.g. day count or sidebar changes).
watch(
  () => columnEls.value[0] ?? null,
  (column) => {
    if (observedColumn && resizeObserver) resizeObserver.unobserve(observedColumn);
    observedColumn = column;
    if (column && resizeObserver) resizeObserver.observe(column);
    measureColumns();
  },
  { flush: "post" }
);

watch(
  () => props.days.length,
  () => void nextTick(measureColumns)
);

// ------------------------------------------------------------------ phone day swipe
// Single-day view only (phones), touch only. Decision logic lives in planner/daySwipe.ts; this
// part wires pointer events, the follow-the-finger offset and the slide animation.
// Arbitration: a pending long-press gives way (the drag composable cancels it after 8px, before
// the swipe locks at 10px); an ACTIVE task drag disables the swipe (its edge auto-advance changes
// day); overlays, a mouse/pen drag-create and a second finger abort it; any sequence that moved
// suppresses the click/tap on release.
const SWIPE_ANIMATION_MS = 200;
const swipeX = ref(0);
const swipeAnimating = ref(false);
let swipe: SwipeState | null = null;
let swipeClickBlockUntil = 0;
let swipeTimer: number | undefined;

const swipeEnabled = computed(() => isSingleDay.value);

function swipeWidth(): number {
  return Math.max(1, columnWidth.value);
}

function onSwipePointerDown(event: PointerEvent): void {
  if (!swipeEnabled.value || event.pointerType !== "touch") return;
  if (swipe && swipe.pointerId !== event.pointerId) {
    // A second finger (pinch, two-finger scroll): this is not a swipe.
    endSwipeTracking(true);
    return;
  }
  const enabled =
    !hasOpenOverlay.value && !drag.dragTaskId.value && !creating.value?.active && !swipeAnimating.value;
  swipe = startSwipe({
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    t: event.timeStamp,
    viewportWidth: window.innerWidth,
    enabled,
  });
  if (swipe.phase === "cancelled") {
    swipe = null;
    return;
  }
  window.addEventListener("pointermove", onSwipePointerMove, { passive: true });
  window.addEventListener("pointerup", onSwipePointerUp);
  window.addEventListener("pointercancel", onSwipePointerCancel);
}

function onSwipePointerMove(event: PointerEvent): void {
  if (!swipe || event.pointerId !== swipe.pointerId) return;
  if (drag.dragTaskId.value) {
    // The long-press fired: the task drag owns this touch now.
    endSwipeTracking(true);
    return;
  }
  swipe = moveSwipe(swipe, { x: event.clientX, y: event.clientY, t: event.timeStamp });
  if (swipe.phase === "vertical") {
    // Native vertical scrolling owns it.
    endSwipeTracking(false);
    return;
  }
  if (swipe.phase === "swiping") {
    hover.value = null;
    swipeX.value = swipeOffset(swipe.dx, swipeWidth());
  }
}

function onSwipePointerUp(event: PointerEvent): void {
  if (!swipe || event.pointerId !== swipe.pointerId) return;
  const result = endSwipe(swipe, { t: event.timeStamp, width: swipeWidth() });
  removeSwipeListeners();
  swipe = null;
  if (result.suppressClick) swipeClickBlockUntil = performance.now() + 400;
  finishSwipe(outcomeSide(result.outcome));
}

function onSwipePointerCancel(event: PointerEvent): void {
  if (swipe && event.pointerId === swipe.pointerId) endSwipeTracking(true);
}

function removeSwipeListeners(): void {
  window.removeEventListener("pointermove", onSwipePointerMove);
  window.removeEventListener("pointerup", onSwipePointerUp);
  window.removeEventListener("pointercancel", onSwipePointerCancel);
}

/** Stop tracking; `springBack` returns a partly swiped day to its place. */
function endSwipeTracking(springBack: boolean): void {
  if (swipe && abortSwipe(swipe).moved) swipeClickBlockUntil = performance.now() + 400;
  swipe = null;
  removeSwipeListeners();
  if (springBack && swipeX.value !== 0) finishSwipe(0);
}

/** A click right after a swipe (or a moved touch) must not open a task or create one. */
function onScrollerClickCapture(event: MouseEvent): void {
  if (performance.now() < swipeClickBlockUntil) {
    event.preventDefault();
    event.stopPropagation();
  }
}

/** Spring back (side 0), or slide the day out and the next one in from the other side. */
function finishSwipe(side: -1 | 0 | 1): void {
  window.clearTimeout(swipeTimer);
  if (side === 0) {
    animateSwipeTo(0);
    return;
  }
  if (prefersReducedMotion.value) {
    swipeAnimating.value = false;
    swipeX.value = 0;
    navigateBySwipe(side);
    return;
  }
  animateSwipeTo(-side * swipeWidth(), () => {
    // Old day is off screen: switch, place the new day on the opposite side, slide it in.
    swipeAnimating.value = false;
    swipeX.value = side * swipeWidth();
    navigateBySwipe(side);
    void nextTick(() => {
      void scroller.value?.offsetWidth; // commit the start position before animating
      animateSwipeTo(0);
    });
  });
}

function animateSwipeTo(target: number, done?: () => void): void {
  if (prefersReducedMotion.value) {
    swipeAnimating.value = false;
    swipeX.value = target;
    done?.();
    return;
  }
  swipeAnimating.value = true;
  swipeX.value = target;
  swipeTimer = window.setTimeout(() => {
    swipeAnimating.value = false;
    done?.();
  }, SWIPE_ANIMATION_MS);
}

function navigateBySwipe(side: -1 | 1): void {
  const day = addDays(props.days[0]!, side);
  holdAutoScroll(); // keep the vertical position across the day change (also into another week)
  emit("advance", side);
  uiStore.announce(formatGridRegionLabel([day]));
}

// Leaving the single-day view mid-swipe (rotation, resize): reset.
watch(swipeEnabled, (enabled) => {
  if (enabled) return;
  endSwipeTracking(false);
  swipeAnimating.value = false;
  swipeX.value = 0;
});

onBeforeUnmount(() => {
  stopCreate();
  removeSwipeListeners();
  window.clearTimeout(swipeTimer);
  resizeObserver?.disconnect();
  window.clearTimeout(freshTimer);
});

defineExpose({ scrollToNow, autoScroll });

// ------------------------------------------------------------------ template helpers
function isWeekend(day: DateKey): boolean {
  return isoWeekday(day) >= 6;
}
function hourLabel(h: number): string {
  return formatHourLabel(h);
}
const gridStyle = computed(() => ({
  "--hour-h": `${HOUR_HEIGHT}px`,
  "--_cols": String(props.days.length),
  "--swipe-x": `${swipeX.value}px`,
}));
</script>

<template>
  <div class="week-view">
  <div
    ref="scroller"
    class="grid-scroller"
    :class="{ 'grid-scroller--single': isSingleDay }"
    role="region"
    :aria-label="regionLabel"
    :aria-busy="busy || undefined"
    tabindex="0"
    data-hotkey-arrows
    @pointerdown.capture="onSwipePointerDown"
    @click.capture="onScrollerClickCapture"
  >
    <p :id="hintId" class="sr-only">{{ keyboardHint }}</p>
    <p :id="readOnlyHintId" class="sr-only">Enter to view. This task is managed by its organization.</p>
    <div
      class="grid"
      :class="{ 'grid--single': isSingleDay, 'is-swiping': swipeX !== 0 || swipeAnimating, 'is-swipe-animating': swipeAnimating }"
      :style="gridStyle"
    >
      <div class="grid__corner" aria-hidden="true">
        <span class="tabular">{{ cornerLabel }}</span>
      </div>

      <div
        v-for="day in days"
        :key="`head-${day}`"
        class="day-head"
        :class="{ 'is-today': day === today, 'is-weekend': isWeekend(day) }"
        aria-hidden="true"
      >
        <span class="day-head__weekday">{{ formatWeekdayMicro(day) }}</span>
        <span class="day-head__row">
          <span class="day-head__date tabular">{{ formatDayOfMonth(day) }}</span>
          <span v-if="(dayStats.get(day)?.hours ?? 0) > 0 && columnWidth >= 100" class="day-head__total tabular">
            · {{ formatHoursCompact(dayStats.get(day)!.hours) }}
          </span>
        </span>
      </div>

      <div class="grid__gutter" aria-hidden="true">
        <span v-for="h in hours" v-show="h > 0" :key="h" class="gutter-label tabular" :style="{ top: `${h * HOUR_HEIGHT}px` }">
          {{ hourLabel(h) }}
        </span>
        <NowIndicator v-if="showNow" :now="now" variant="pill" />
      </div>

      <div
        v-for="(day, index) in days"
        :key="`col-${index}`"
        :ref="(el) => setColumnRef(el, index)"
        class="day-col"
        :class="{ 'is-today': day === today, 'is-weekend': isWeekend(day) }"
        role="group"
        :aria-label="formatDayGroupLabel(day, dayStats.get(day)?.count ?? 0, dayStats.get(day)?.hours ?? 0)"
        @pointerdown="onColumnPointerDown($event, day, index)"
        @pointermove="onColumnPointerMove($event, day, index)"
        @pointerleave="onColumnPointerLeave"
      >
        <div
          v-if="hover && hover.day === day"
          class="hover-slot"
          :style="{ top: `${hover.minutes * PX_PER_MINUTE}px`, height: `${HOUR_HEIGHT - 2}px` }"
          aria-hidden="true"
        >
          <span class="hover-slot__label tabular">+ {{ formatTimeOfDay(hover.minutes) }}</span>
        </div>

        <TaskBlock
          v-for="item in itemsByDay.get(day)"
          :key="item.key"
          :task="item.task"
          :color="categoryOf(item.task).color"
          :category-name="categoryOf(item.task).name"
          :variant="item.variant"
          :column-width="columnWidth"
          :saving="item.saving"
          :conflict="item.conflict"
          :fresh="freshId === item.task.id && item.variant === 'task'"
          :resizable="!isCoarse && item.variant === 'task' && canEditTask(item.task)"
          :hint-id="canEditTask(item.task) ? hintId : readOnlyHintId"
          :placement="item.placement"
          :read-only="!canEditTask(item.task)"
          :org-name="isOrgTask(item.task) ? organizationLabel(item.task) : null"
          @press="(e, mode) => onTaskPress(item.task, e, mode)"
          @activate="(e) => onTaskActivate(item.task, e)"
          @keydown="(e) => onTaskKeydown(item.task, e)"
        />

        <TaskBlock
          v-if="draftBlock && draftBlock.day === day"
          :task="draftBlock.task"
          :color="'var(--accent)'"
          variant="draft"
          :column-width="columnWidth"
        />

        <NowIndicator v-if="day === today" :now="now" variant="line" />
      </div>
    </div>
  </div>

  <!-- Edge cue while a dragged task is held at the left/right edge: shows the target week. -->
  <div
    v-if="edgeCue"
    class="edge-cue"
    :class="edgeCue.side < 0 ? 'edge-cue--left' : 'edge-cue--right'"
    aria-hidden="true"
  >
    <span class="edge-cue__pill">
      <ChevronLeft v-if="edgeCue.side < 0" :size="14" />
      <span class="edge-cue__label">{{ edgeLabel }}</span>
      <ChevronRight v-if="edgeCue.side > 0" :size="14" />
      <span :key="edgeCue.cycle" class="edge-cue__progress" :style="{ animationDuration: `${edgeCue.durationMs}ms` }" />
    </span>
  </div>
  </div>
</template>

<style scoped>
.week-view {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

/* ----- cross-week edge cue (drag held at the left/right edge) ----- */
.edge-cue {
  position: absolute;
  top: var(--dayhead-h);
  bottom: 0;
  z-index: var(--z-grid-corner);
  width: 48px;
  pointer-events: none;
}
.edge-cue--left {
  left: var(--gutter-w);
  background: linear-gradient(to right, color-mix(in srgb, var(--accent) 18%, transparent), transparent);
  box-shadow: inset 2px 0 0 var(--accent);
}
.edge-cue--right {
  right: 0;
  background: linear-gradient(to left, color-mix(in srgb, var(--accent) 18%, transparent), transparent);
  box-shadow: inset -2px 0 0 var(--accent);
}
.edge-cue__pill {
  position: absolute;
  top: var(--space-4);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1-5) var(--space-2-5);
  overflow: hidden;
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-full);
  background-color: var(--bg-raised);
  box-shadow: var(--shadow-md);
  color: var(--accent-text);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  font-weight: var(--fw-semibold);
  white-space: nowrap;
}
.edge-cue--left .edge-cue__pill {
  left: var(--space-2);
}
.edge-cue--right .edge-cue__pill {
  right: var(--space-2);
}
/* Fills while the pointer dwells; the view moves when it is full. */
.edge-cue__progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 100%;
  background-color: var(--accent);
  transform-origin: left center;
  animation-name: edge-cue-progress;
  animation-timing-function: linear;
  animation-fill-mode: both;
}
@keyframes edge-cue-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .edge-cue__progress {
    animation: none;
    transform: none;
    opacity: 0.6;
  }
}
@media (forced-colors: active) {
  .edge-cue {
    background: none;
    border-inline: 2px solid Highlight;
  }
}

.grid-scroller {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  background-color: var(--grid-bg);
  outline: none;
}
.grid-scroller:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}

.grid {
  display: grid;
  grid-template-columns: var(--gutter-w) repeat(var(--_cols), minmax(var(--day-min-w), 1fr));
  grid-template-rows: var(--dayhead-h) calc(24 * var(--hour-h));
  min-width: 100%;
  width: max-content;
}
.grid--single {
  grid-template-columns: var(--gutter-w) minmax(0, 1fr);
  width: 100%;
}

/*
 * Phone day swipe. touch-action matrix (effective value = intersection up to the scroller):
 *   .grid-scroller--single  pan-y pinch-zoom  vertical scroll + pinch stay native; horizontal
 *                                             single-finger gestures come to JS (day swipe)
 *   .grid-scroller (multi)  auto              both axes (narrow tablets scroll sideways)
 *   .day-col (multi)        pan-x pan-y       unchanged
 *   .task-block             pan-y pinch-zoom  scroll can start on a block; horizontal → JS
 *                                             (swipe before the long-press, drag after it)
 * The day content (header + column) follows the finger; the hour gutter stays put.
 */
.grid-scroller--single {
  touch-action: pan-y pinch-zoom;
  overflow-x: hidden;
  overscroll-behavior-x: none;
}
.grid--single .day-col {
  touch-action: pan-y pinch-zoom;
}
.grid.is-swiping .day-col,
.grid.is-swiping .day-head {
  transform: translateX(var(--swipe-x, 0px));
}
.grid.is-swipe-animating .day-col,
.grid.is-swipe-animating .day-head {
  transition: transform 200ms var(--ease-out);
}
@media (prefers-reduced-motion: reduce) {
  .grid.is-swipe-animating .day-col,
  .grid.is-swipe-animating .day-head {
    transition: none;
  }
}

/* ----- sticky corner + headers ----- */
.grid__corner {
  position: sticky;
  top: 0;
  left: 0;
  z-index: var(--z-grid-corner);
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 0 var(--space-2) var(--space-1-5) 0;
  background-color: var(--grid-bg);
  border-bottom: 1px solid var(--grid-line);
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  color: var(--text-tertiary);
}

.day-head {
  position: sticky;
  top: 0;
  z-index: var(--z-grid-sticky);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  padding: 6px 8px;
  background-color: var(--bg-app);
  border-bottom: 1px solid var(--grid-line);
  border-left: 1px solid var(--grid-line);
  overflow: hidden;
}
.day-head__weekday {
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-medium);
  letter-spacing: var(--tracking-caps);
  color: var(--text-tertiary);
}
.day-head__row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  white-space: nowrap;
}
.day-head__date {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  margin-left: -4px;
  padding: 0 4px;
  border-radius: var(--radius-full);
  font-size: var(--fs-20);
  line-height: var(--lh-20);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--text-primary);
}
.day-head.is-today .day-head__weekday {
  color: var(--accent-text);
}
.day-head.is-today .day-head__date {
  background-color: var(--accent);
  color: var(--text-on-accent);
}
.day-head__total {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}

/* ----- gutter ----- */
.grid__gutter {
  position: sticky;
  left: 0;
  z-index: var(--z-grid-sticky);
  background-color: var(--grid-bg);
}
.gutter-label {
  position: absolute;
  right: 0;
  padding-right: var(--space-2);
  transform: translateY(-50%);
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-medium);
  color: var(--text-tertiary);
  white-space: nowrap;
}

/* ----- day columns ----- */
.day-col {
  position: relative;
  min-width: 0;
  border-left: 1px solid var(--grid-line);
  background-color: var(--grid-bg);
  background-image: linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-line-half) 1px, transparent 1px);
  background-size: 100% var(--hour-h), 100% var(--hour-h);
  background-position: 0 0, 0 calc(var(--hour-h) / 2);
  cursor: default;
  touch-action: pan-x pan-y;
}
.day-col.is-weekend {
  background-color: var(--grid-weekend);
}
.day-col.is-today {
  background-image: linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--grid-line-half) 1px, transparent 1px),
    linear-gradient(var(--grid-today), var(--grid-today));
  background-size: 100% var(--hour-h), 100% var(--hour-h), 100% 100%;
  background-position: 0 0, 0 calc(var(--hour-h) / 2), 0 0;
}

.hover-slot {
  position: absolute;
  left: 2px;
  right: 6px;
  z-index: 1;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background-color: var(--grid-hover);
  pointer-events: none;
}
.hover-slot__label {
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-medium);
  color: var(--accent-text);
}

@media (forced-colors: active) {
  .day-col {
    border-left-color: CanvasText;
  }
}
</style>

<style>
/* While a task is dragged: no text selection anywhere, grabbing cursor. */
html.is-dragging-task,
html.is-dragging-task * {
  user-select: none !important;
  -webkit-user-select: none !important;
  cursor: grabbing !important;
}
/* While someone tries to drag a read-only org task: "not allowed". */
html.is-drag-blocked,
html.is-drag-blocked * {
  user-select: none !important;
  -webkit-user-select: none !important;
  cursor: not-allowed !important;
}
</style>
