// src/composables/useSessionBound.ts — UI that belongs to one session closes when it ends.
//
// When authStore.sessionEpoch changes (logout here or in another tab, a session that expired, a
// new login), an open task editor, category/template editor, confirm dialog or Undo toast would
// otherwise act on the next session: a create-mode Save would silently create a guest task, an
// Undo would re-create an account task in guest data. Closing them follows the normal dialog
// rules: focus goes back to the element that opened the dialog if it is still on the page,
// nothing else is focused.

import { watch, type WatchStopHandle } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { useTaskEditor } from "@/composables/useTaskEditor";

/**
 * Run `callback` whenever the session changes, synchronously (before guest data replaces the
 * account's). In a component setup the watcher stops with the component.
 */
export function onSessionChange(callback: () => void): WatchStopHandle {
  const auth = useAuthStore();
  return watch(
    () => auth.sessionEpoch,
    () => callback(),
    { flush: "sync" }
  );
}

/**
 * Close the app-wide session-bound UI: the task editor, a pending confirm dialog (answered as
 * dismissed) and a toast with an action (e.g. Undo). Component-local dialogs (category/template
 * editors) close themselves with onSessionChange.
 */
export function closeSessionBoundUi(): void {
  useTaskEditor().close();
  const ui = useUIStore();
  if (ui.confirmationDialog.isOpen) ui.answerConfirmation(null);
  if (ui.toast.isVisible && ui.toast.action) ui.hideToast();
}
