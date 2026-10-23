// src/stores/uiStore.ts

import { defineStore } from "pinia";
import dayjs from "dayjs";
import router from "@/router"; // ADDED: Import the router for redirection

type ToastType = "success" | "error" | "info";

export const useUIStore = defineStore("ui", {
  state: () => ({
    currentDate: dayjs().toISOString(),

    toast: {
      message: "",
      type: "success" as ToastType,
      isVisible: false,
    },
    _timeoutId: null as number | null,

    confirmationDialog: {
      isOpen: false,
      title: "Are you sure?",
      message: "This action cannot be undone.",
      // These will hold the functions to call on resolve/reject
      _resolve: null as ((value: boolean | null) => void) | null,
    },
  }),

  actions: {
    confirm(
      title: string,
      message: string,
      options?: { confirmText?: string; cancelText?: string }
    ): Promise<boolean | null> {
      this.confirmationDialog.title = title;
      this.confirmationDialog.message = message;
      // Add dynamic button text to the state
      (this.confirmationDialog as any).confirmText =
        options?.confirmText || "Confirm";
      (this.confirmationDialog as any).cancelText =
        options?.cancelText || "Cancel";
      this.confirmationDialog.isOpen = true;

      return new Promise((resolve) => {
        this.confirmationDialog._resolve = resolve;
      });
    },

    answerConfirmation(answer: boolean | null) {
      if (this.confirmationDialog._resolve) {
        // We resolve with the boolean answer (true for confirm, false for cancel)
        this.confirmationDialog._resolve(answer);
      }
      this.confirmationDialog.isOpen = false;
      this.confirmationDialog._resolve = null;
    },
    goToToday() {
      this.currentDate = dayjs().toISOString();
    },

    /**
     * Shows a toast notification.
     * @param message The message to display.
     * @param type The type of toast ('success', 'error', 'info').
     * @param duration The duration in milliseconds before the toast disappears.
     */
    showToast(
      message: string,
      type: ToastType = "info",
      duration: number = 4000
    ) {
      // If a toast is already visible, hide it instantly before showing the new one
      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
        this._timeoutId = null;
      }

      this.toast.message = message;
      this.toast.type = type;
      this.toast.isVisible = true;

      this._timeoutId = window.setTimeout(() => {
        this.hideToast();
      }, duration);
    },

    hideToast() {
      this.toast.isVisible = false;
      this.toast.message = "";
      if (this._timeoutId) {
        clearTimeout(this._timeoutId);
        this._timeoutId = null;
      }
    },
  },
});
