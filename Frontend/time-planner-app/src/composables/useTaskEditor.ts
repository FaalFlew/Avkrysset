// src/composables/useTaskEditor.ts — shared state of the one global task editor (mounted in App.vue).
//
// Every entry point (N, the FAB, the sidebar button, a click/drag on the grid, a Today row, a
// free-time gap) opens the same editor through this module-level singleton. The editor writes
// its live field values into `draft`, so the planner can show a draft block that follows them.

import { reactive, readonly, ref } from "vue";
import type { Task } from "@/types";
import type { AnchorRect } from "@/components/ui/types";
import type { DateKey, UtcIsoString } from "@/lib/datetime";
import { defaultNewTaskStart } from "@/lib/plannerFormat";

export type EditorMode = "create" | "edit";

export interface EditorDraft {
  /** Start instant of the task being created/edited (follows the editor fields). */
  start: UtcIsoString;
  /** Duration in hours (follows the editor fields). */
  durationH: number;
  title: string;
  categoryId: string;
}

interface EditorState {
  open: boolean;
  mode: EditorMode;
  /** The task being edited (edit mode). */
  task: Task | null;
  /** Rect of the block/draft the editor is anchored to (≥ 1024px). */
  anchorRect: AnchorRect | null;
  /** Increments on every open, so the editor re-initializes its fields. */
  session: number;
}

const state = reactive<EditorState>({
  open: false,
  mode: "create",
  task: null,
  anchorRect: null,
  session: 0,
});

const draft = reactive<EditorDraft>({
  start: "",
  durationH: 1,
  title: "",
  categoryId: "",
});

/** Id of the task most recently created or saved (the planner flashes it briefly). */
const lastSavedTaskId = ref<string | null>(null);
let lastSavedTimer: number | undefined;

/** Visible planner days, registered by the planner while it is mounted (for the default start). */
let visibleDaysProvider: (() => readonly DateKey[]) | null = null;

function toRect(rect: AnchorRect | DOMRect | null | undefined): AnchorRect | null {
  if (!rect) return null;
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export interface OpenCreateOptions {
  start?: UtcIsoString;
  durationH?: number;
  title?: string;
  anchorRect?: AnchorRect | DOMRect | null;
}

function openCreate(options: OpenCreateOptions = {}): void {
  draft.start = options.start ?? defaultNewTaskStart(visibleDaysProvider?.());
  draft.durationH = options.durationH && options.durationH > 0 ? options.durationH : 1;
  draft.title = options.title ?? "";
  draft.categoryId = "";
  state.mode = "create";
  state.task = null;
  state.anchorRect = toRect(options.anchorRect);
  state.session += 1;
  state.open = true;
}

function openEdit(task: Task, anchorRect?: AnchorRect | DOMRect | null): void {
  draft.start = task.start;
  draft.durationH = task.duration;
  draft.title = task.title;
  draft.categoryId = task.categoryId;
  state.mode = "edit";
  state.task = { ...task };
  state.anchorRect = toRect(anchorRect);
  state.session += 1;
  state.open = true;
}

function close(): void {
  state.open = false;
}

function setAnchorRect(rect: AnchorRect | DOMRect | null): void {
  state.anchorRect = toRect(rect);
}

function markSaved(taskId: string): void {
  lastSavedTaskId.value = taskId;
  window.clearTimeout(lastSavedTimer);
  lastSavedTimer = window.setTimeout(() => {
    lastSavedTaskId.value = null;
  }, 900);
}

/** Register the planner's visible days (call with `null` on unmount). */
function setVisibleDaysProvider(provider: (() => readonly DateKey[]) | null): void {
  visibleDaysProvider = provider;
}

export function useTaskEditor() {
  return {
    /** Read-only editor state: open, mode, task, anchorRect, session. */
    state: readonly(state),
    /** Live field values (written by the editor, read by the planner's draft block). */
    draft,
    lastSavedTaskId: readonly(lastSavedTaskId),
    openCreate,
    openEdit,
    close,
    setAnchorRect,
    markSaved,
    setVisibleDaysProvider,
  };
}
