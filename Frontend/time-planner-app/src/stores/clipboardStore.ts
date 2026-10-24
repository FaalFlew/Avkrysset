// src/stores/clipboardStore.ts — the planner's task clipboard (copy, paste, duplicate).
//
// In memory only, so a copy survives week navigation but never a reload. It belongs to the session
// it was made in: once authStore.sessionEpoch moves on (logout here or in another tab, an expired
// session, a login) the copy is gone — an account task can never be pasted into guest data or
// into another account. Phones paste by tapping a time after "Copy" in the task editor: `armed`
// shows the "Tap a time to paste" banner until a paste succeeds or the user cancels.
// The rules (personal copies, paste targets, DST-safe duplicates) live in src/lib/taskClipboard.ts.

import { defineStore } from "pinia";
import type { Task } from "@/types";
import { useAuthStore } from "./authStore";
import { useTaskStore } from "./taskStore";
import { useUIStore } from "./uiStore";
import { copyOf, duplicateStart, newTaskFromCopy, type CopiedTask } from "@/lib/taskClipboard";
import { readLastCategory } from "@/lib/lastCategory";
import { displayTitle } from "@/lib/plannerFormat";
import type { UtcIsoString } from "@/lib/datetime";

export const useClipboardStore = defineStore("taskClipboard", {
  state: () => ({
    entry: null as CopiedTask | null,
    /** Session epoch the entry was copied in. */
    epoch: -1,
    /** Tap-to-paste mode (after "Copy" in the editor): the next tap on a free slot pastes. */
    armed: false,
  }),

  getters: {
    /** The copied task of the current session, or null. */
    copied(state): CopiedTask | null {
      return state.entry && state.epoch === useAuthStore().sessionEpoch ? state.entry : null;
    },
    /** Tap-to-paste mode is on (and something of this session is copied). */
    isArmed(): boolean {
      return this.armed && this.copied !== null;
    },
  },

  actions: {
    /**
     * Copy `task` (a read-only org task becomes a personal copy, see taskClipboard.ts).
     * `arm` turns on tap-to-paste (the banner says what to do next); otherwise a short toast
     * confirms — unless a toast with an action (e.g. Undo) is up, which must not be replaced.
     */
    copy(task: Task, options: { arm?: boolean } = {}): CopiedTask {
      const taskStore = useTaskStore();
      const uiStore = useUIStore();
      this.entry = copyOf(task, { categories: taskStore.categories, templates: taskStore.templates });
      this.epoch = useAuthStore().sessionEpoch;
      this.armed = !!options.arm;
      const title = displayTitle(task.title);
      if (!options.arm) {
        if (uiStore.toast.isVisible && uiStore.toast.action) uiStore.announce(`Copied ${title}.`);
        else uiStore.showToast(`Copied “${title}”`, "info", 2500);
      }
      return this.entry;
    },

    /** Leave tap-to-paste mode (the copy stays for Ctrl/⌘+V and the context menu). */
    disarm() {
      this.armed = false;
    },

    clear() {
      this.entry = null;
      this.epoch = -1;
      this.armed = false;
    },

    /** Paste the copy at `start`. Null when nothing is copied or it was refused (toasted). */
    async paste(start: UtcIsoString): Promise<Task | null> {
      const copied = this.copied;
      if (!copied) return null;
      const created = await this.createFrom(copied, start, "paste");
      if (created) this.armed = false;
      return created;
    },

    /** Duplicate `task` `days` calendar days later at the same wall-clock time (1 or 7). */
    async duplicate(task: Task, days: number): Promise<Task | null> {
      const taskStore = useTaskStore();
      const copied = copyOf(task, { categories: taskStore.categories, templates: taskStore.templates });
      return this.createFrom(copied, duplicateStart(task.start, days), "duplicate");
    },

    async createFrom(copied: CopiedTask, start: UtcIsoString, kind: "paste" | "duplicate"): Promise<Task | null> {
      const taskStore = useTaskStore();
      const data = newTaskFromCopy(copied, start, {
        categories: taskStore.categories,
        lastCategoryId: readLastCategory(),
      });
      if (!data) {
        useUIStore().showToast("Add a category first.", "error");
        return null;
      }
      return taskStore.addTaskCopy(data, kind);
    },
  },
});
