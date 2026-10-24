// src/stores/uiStore.ts — app-wide UI state: selected planner date, toast, confirm dialog,
// screen-reader announcements and the keyboard-shortcuts dialog.

import { defineStore } from "pinia";
import { todayKey, type DateKey } from "@/lib/datetime";
import type { ConfirmTone, ToastAction } from "@/components/ui/types";

export type ToastType = "success" | "error" | "info";

export interface ToastOptions {
  /** Optional action button (e.g. "Undo"). Clicking it runs onClick and hides the toast. */
  action?: ToastAction;
  /** Marks the action as an undo: Ctrl/⌘+Z runs it while the toast is visible. */
  undo?: boolean;
  /**
   * The action the toast is about (e.g. "task:add", "task:update:<id>"), so a later success of
   * that same action can dismiss its stale error toast (dismissToast). Other toasts stay.
   */
  key?: string;
}

export interface ConfirmOptions {
  confirmText?: string;
  cancelText?: string;
  /** 'danger' renders a red confirm button and focuses Cancel first. */
  tone?: ConfirmTone;
}

export interface ToastState {
  message: string;
  type: ToastType;
  isVisible: boolean;
  action: ToastAction | null;
  /** True when `action` is an undo (Ctrl/⌘+Z triggers it). */
  undo: boolean;
  /** ToastOptions.key of the visible toast, or null. */
  key: string | null;
}

export interface ConfirmationDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  tone: ConfirmTone;
  _resolve: ((value: boolean | null) => void) | null;
}

export const useUIStore = defineStore("ui", {
  state: () => ({
    /** Calendar date (`YYYY-MM-DD` in the user's zone) the planner shows (its ISO week; the day on phones). */
    currentDate: todayKey() as DateKey,

    toast: {
      message: "",
      type: "success",
      isVisible: false,
      action: null,
      undo: false,
      key: null,
    } as ToastState,
    _timeoutId: null as number | null,
    /** Rendered height of the visible toast in px (measured by ToastNotification; 0 = unknown). */
    toastHeight: 0,
    /** When the current toast hides (performance.now() ms), and the time left while paused. */
    _toastDeadline: 0,
    _toastRemaining: null as number | null,

    confirmationDialog: {
      isOpen: false,
      title: "Are you sure?",
      message: "This action cannot be undone.",
      confirmText: "Confirm",
      cancelText: "Cancel",
      tone: "default",
      _resolve: null,
    } as ConfirmationDialogState,

    /** Polite screen-reader announcement (rendered by App.vue's live region). */
    announcement: "",

    /** Keyboard shortcuts dialog. */
    shortcutsOpen: false,

    /** Task the planner should focus once it renders (consumed by WeekView). */
    taskFocusRequest: null as string | null,
  }),

  actions: {
    /**
     * Ask the user to confirm. Resolves `true` (confirm), `false` (cancel) or `null`
     * (dismissed with Esc / outside click / X — callers may treat it as "abort").
     */
    confirm(title: string, message: string, options: ConfirmOptions = {}): Promise<boolean | null> {
      // A still-pending confirm is answered as dismissed before the new one replaces it.
      this.confirmationDialog._resolve?.(null);
      this.confirmationDialog.title = title;
      this.confirmationDialog.message = message;
      this.confirmationDialog.confirmText = options.confirmText || "Confirm";
      this.confirmationDialog.cancelText = options.cancelText || "Cancel";
      this.confirmationDialog.tone = options.tone ?? "default";
      this.confirmationDialog.isOpen = true;

      return new Promise((resolve) => {
        this.confirmationDialog._resolve = resolve;
      });
    },

    answerConfirmation(answer: boolean | null) {
      const resolve = this.confirmationDialog._resolve;
      this.confirmationDialog._resolve = null;
      this.confirmationDialog.isOpen = false;
      resolve?.(answer);
    },

    goToToday() {
      this.currentDate = todayKey();
    },

    /**
     * Show a toast notification (replaces the current one).
     * @param message Text to show.
     * @param type 'success' | 'error' | 'info'.
     * @param duration Milliseconds before it hides (default 4000).
     * @param options Optional `{ action: { label, onClick }, undo }`.
     */
    showToast(message: string, type: ToastType = "info", duration: number = 4000, options: ToastOptions = {}) {
      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
        this._timeoutId = null;
      }

      this.toast.message = message;
      this.toast.type = type;
      this.toast.action = options.action ?? null;
      this.toast.undo = !!options.action && !!options.undo;
      this.toast.key = options.key ?? null;
      this.toast.isVisible = true;
      this._toastRemaining = null;
      this._startToastTimer(duration);
    },

    _startToastTimer(ms: number) {
      if (this._timeoutId) clearTimeout(this._timeoutId);
      this._toastDeadline = performance.now() + ms;
      this._timeoutId = window.setTimeout(() => {
        this.hideToast();
      }, ms);
    },

    /** Stop the auto-hide countdown (pointer over / focus inside the toast). */
    pauseToast() {
      if (!this.toast.isVisible || this._toastRemaining !== null || !this._timeoutId) return;
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
      this._toastRemaining = Math.max(0, this._toastDeadline - performance.now());
    },

    /** Resume the countdown (at least 1.5s left so a message never vanishes instantly). */
    resumeToast() {
      if (!this.toast.isVisible || this._toastRemaining === null) return;
      const remaining = Math.max(this._toastRemaining, 1500);
      this._toastRemaining = null;
      this._startToastTimer(remaining);
    },

    /** ToastNotification reports the toast's rendered height (what stacks above it moves up). */
    setToastHeight(px: number) {
      this.toastHeight = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
    },

    /**
     * A retry of an action succeeded: hide the toast if it is about that same action (its stale
     * error). Any other toast stays.
     */
    dismissToast(key: string) {
      if (this.toast.isVisible && this.toast.key === key) this.hideToast();
    },

    hideToast() {
      this.toast.isVisible = false;
      this.toast.message = "";
      this.toast.action = null;
      this.toast.undo = false;
      this.toast.key = null;
      this._toastRemaining = null;
      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
        this._timeoutId = null;
      }
    },

    /** Run the visible toast's undo action (Ctrl/⌘+Z). Returns true when something was undone. */
    runToastUndo(): boolean {
      if (!this.toast.isVisible || !this.toast.undo || !this.toast.action) return false;
      const action = this.toast.action;
      this.hideToast();
      action.onClick();
      return true;
    },

    /** Announce a message politely to screen readers (e.g. "Moved Deep work to Tuesday, 09:15 – 10:45."). */
    announce(message: string) {
      // Clear first so repeating the same text is announced again.
      this.announcement = "";
      window.setTimeout(() => {
        this.announcement = message;
      }, 50);
    },

    /** Ask the planner to focus a task block once it is on screen (e.g. after an Undo navigated back). */
    requestTaskFocus(taskId: string) {
      this.taskFocusRequest = taskId;
    },

    openShortcuts() {
      this.shortcutsOpen = true;
    },
  },
});
