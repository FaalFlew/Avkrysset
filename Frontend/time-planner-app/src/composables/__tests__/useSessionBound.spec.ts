/**
 * useSessionBound: when the session changes (logout here or in another tab, expiry, login), the
 * task editor, a pending confirm dialog and an Undo toast of the old session close; a token
 * refresh (same session) closes nothing. The network is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, type EffectScope } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { installBrowserGlobals, makeJwt } from "@/services/__tests__/fakeApi";

vi.mock("@/services/apiService", () => ({ abortSessionRequests: vi.fn() }));
vi.mock("@/services/authService", () => ({ authService: { revokeRefreshToken: vi.fn() } }));

import { closeSessionBoundUi, onSessionChange } from "../useSessionBound";
import { useTaskEditor } from "../useTaskEditor";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";

const storage = installBrowserGlobals();
let scope: EffectScope;

function signedIn() {
  storage.clear();
  storage.set("accessToken", makeJwt({ sub: "user-1" }));
  storage.set("refreshToken", "rt-1");
  setActivePinia(createPinia());
  scope = effectScope();
  scope.run(() => onSessionChange(closeSessionBoundUi));
  return { auth: useAuthStore(), ui: useUIStore(), editor: useTaskEditor() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  scope?.stop();
  useTaskEditor().close();
  vi.useRealTimers();
});

describe("session-bound UI", () => {
  it("logout closes the task editor, dismisses a pending confirm and hides an Undo toast", async () => {
    const { auth, ui, editor } = signedIn();
    editor.openCreate({ title: "Half-typed account task" });
    const undo = vi.fn();
    ui.showToast("Task deleted", "info", 6000, { undo: true, action: { label: "Undo", onClick: undo } });
    const answer = ui.confirm("Delete category?", "Its tasks move to Other.");

    await auth.logout();

    expect(editor.state.open).toBe(false);
    expect(ui.confirmationDialog.isOpen).toBe(false);
    expect(await answer).toBeNull(); // dismissed: the caller aborts
    expect(ui.toast.isVisible).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });

  it("closes on any session change (e.g. another tab's logout ending it)", () => {
    const { auth, editor } = signedIn();
    editor.openEdit({
      id: "t1",
      title: "Account task",
      start: "2026-10-06T07:00:00.000Z",
      duration: 1,
      categoryId: "c1",
      categoryName: "Work",
      categoryColor: "#2F7FE0",
    });
    storage.clear();
    auth._syncFromStorage();
    expect(editor.state.open).toBe(false);
  });

  it("a token refresh (same session) closes nothing; a plain toast stays", () => {
    const { auth, ui, editor } = signedIn();
    editor.openCreate();
    ui.showToast("Category added", "success");
    auth._setTokens(makeJwt({ sub: "user-1", jti: "2" }), "rt-2");
    expect(editor.state.open).toBe(true);
    expect(ui.toast.isVisible).toBe(true);
  });

  it("a toast without an action survives a session change", async () => {
    const { auth, ui } = signedIn();
    ui.showToast("Your session has expired. Please log in again.", "info");
    await auth.logout();
    expect(ui.toast.isVisible).toBe(true);
  });

  it("onSessionChange stops with its scope", async () => {
    const { auth, editor } = signedIn();
    scope.stop();
    editor.openCreate();
    await auth.logout();
    expect(editor.state.open).toBe(true);
  });
});
