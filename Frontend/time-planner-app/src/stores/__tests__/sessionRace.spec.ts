/**
 * The cold-start logout race (docs/plans/auth-session-race.md) at the store level: the real
 * stores, services and apiService against the in-memory fake API (services/__tests__/fakeApi.ts).
 * A late answer for a session that ended must never change the state or reach guest storage, and
 * must stay silent (no toast). Ends with the owner's scenario, start to finish.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Router } from "vue-router";
import type { Category, Task } from "@/types";
import {
  CATEGORY,
  FakeApi,
  flushMicrotasks,
  installBrowserGlobals,
} from "@/services/__tests__/fakeApi";

const routerPush = vi.fn();
vi.mock("@/router", () => ({ default: { push: routerPush } }));

import apiService, { resetSessionGuard } from "@/services/apiService";
import { useAuthStore } from "../authStore";
import { canPersistGuestData, setupTaskStoreSubscribers, useTaskStore } from "../taskStore";
import { useUIStore } from "../uiStore";
import { logoutAndRedirect } from "@/components/shell/useShell";
import { weekRange } from "@/lib/datetime";

const TASKS_KEY = "vue-time-planner-tasks";
const CATEGORIES_KEY = "vue-time-planner-categories";
const OTHER: Category = { id: "c-other", name: "Other", color: "#8A8F98" };
const WEEK = weekRange("2026-10-05");
const START = "2026-10-06T07:00:00.000Z";

const storage = installBrowserGlobals();
const originalAdapter = apiService.defaults.adapter;
let api: FakeApi;

function guestTask(id: string, title: string): Task {
  return { id, title, start: START, duration: 1, categoryId: OTHER.id, categoryName: OTHER.name, categoryColor: OTHER.color };
}

function storedGuestTasks(): Task[] {
  return JSON.parse(storage.get(TASKS_KEY) ?? "[]") as Task[];
}

/** Guest data from before the user signed in. */
function seedGuestStorage(): void {
  storage.set(TASKS_KEY, JSON.stringify([guestTask("g0", "Guest plan from before")]));
  storage.set(CATEGORIES_KEY, JSON.stringify([OTHER]));
}

/** Page load with a session the server knows; categories and the week are loaded. */
async function bootSignedIn() {
  const tokens = api.issueTokens();
  storage.set("accessToken", tokens.accessToken);
  storage.set("refreshToken", tokens.refreshToken);
  setActivePinia(createPinia());
  const auth = useAuthStore();
  const store = useTaskStore();
  const ui = useUIStore();
  setupTaskStoreSubscribers();
  if (!api.tasks.some((t) => t.id === "server-task-0")) {
    api.tasks.push({ ...guestTask("server-task-0", "Account task"), categoryId: CATEGORY.id });
  }
  await store.initializeData();
  await store.fetchTasksForRange(WEEK);
  expect(store.categories).toEqual([CATEGORY]);
  expect(store.tasks.map((t) => t.title)).toEqual(["Account task"]);
  return { auth, store, ui };
}

const fakeRouter = { push: vi.fn(async () => undefined) } as unknown as Router;
const until = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  storage.clear();
  api = new FakeApi();
  apiService.defaults.adapter = api.adapter;
  routerPush.mockReset();
  resetSessionGuard();
});

afterEach(async () => {
  api.wake();
  await flush();
  apiService.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
});

describe("store actions after the session ended", () => {
  it("addTask: the account's answer after logout is dropped — store unchanged, no toast", async () => {
    seedGuestStorage();
    const { auth, store, ui } = await bootSignedIn();
    api.cold = true;
    api.honourAbort = false; // the server answers anyway

    const created = store.addTask({ title: "Slow account task", start: START, duration: 1, categoryId: CATEGORY.id });
    await until(() => api.heldCount === 1);
    await auth.logout();
    await store.initializeData(); // guest data, as App.vue / logoutAndRedirect do
    const guestState = JSON.stringify(store.$state);

    api.wake();
    expect(await created).toBeNull();
    await flush();

    expect(JSON.stringify(store.$state)).toBe(guestState);
    expect(store.tasks.map((t) => t.title)).toEqual(["Guest plan from before"]);
    expect(ui.toast.isVisible).toBe(false);
    expect(api.tasks.map((t) => t.title)).toContain("Slow account task"); // it IS in the account
  });

  it("fetchTasksForRange / fetchTodayTasks: late weeks don't replace guest tasks or show an error", async () => {
    seedGuestStorage();
    const { auth, store } = await bootSignedIn();
    api.cold = true;
    api.honourAbort = false;
    const week = store.fetchTasksForRange(WEEK);
    const today = store.fetchTodayTasks("2026-10-06");
    await until(() => api.heldCount === 2);

    await auth.logout();
    await store.initializeData();
    api.wake();
    await Promise.all([week, today]);

    expect(store.tasks.map((t) => t.title)).toEqual(["Guest plan from before"]);
    expect(store.todayTasks).toEqual([]);
    expect(store.weekError).toBeNull();
    expect(store.todayError).toBeNull();
  });

  it("deleteTask: an aborted DELETE is not 'restored' into the guest list, and Undo after logout does nothing", async () => {
    seedGuestStorage();
    const { auth, store, ui } = await bootSignedIn();

    // 1. DELETE still in flight at logout.
    api.cold = true;
    const pending = store.deleteTask("server-task-0");
    await until(() => api.heldCount === 1);
    await auth.logout();
    await store.initializeData();
    expect(await pending).toBe(false);
    expect(store.tasks.map((t) => t.title)).toEqual(["Guest plan from before"]);
    expect(ui.toast.type).not.toBe("error");
    api.wake();
    await flush();

    // 2. DELETE done, then logout, then Undo (still on screen for a few seconds).
    const second = await bootSignedIn();
    expect(await second.store.deleteTask("server-task-0")).toBe(true);
    expect(second.ui.toast.undo).toBe(true);
    await second.auth.logout();
    await second.store.initializeData();
    const posts = api.find("POST", "/tasks").length;

    expect(second.ui.runToastUndo()).toBe(true);
    await flush();
    expect(api.find("POST", "/tasks")).toHaveLength(posts);
    expect(second.store.tasks.map((t) => t.title)).toEqual(["Guest plan from before"]);
    expect(storedGuestTasks().map((t) => t.title)).toEqual(["Guest plan from before"]);
  });

  it("initializeData: a new login never joins the previous session's pending initialization", async () => {
    const { auth, store } = await bootSignedIn();
    api.cold = true;
    api.honourAbort = false;
    store.categories = [];
    const oldInit = store.initializeData();
    await until(() => api.heldCount === 2);

    await auth.logout();
    api.cold = false;
    expect(await auth.login({ email: "a@b.c", password: "pw" })).toBe(true);
    await store.initializeData(); // must send its own requests

    expect(store.categories).toEqual([CATEGORY]);
    expect(store.isInitializing).toBe(false);
    api.wake(); // the old init's answers arrive late
    await oldInit;
    expect(store.initError).toBeNull();
    expect(store.isInitializing).toBe(false);
  });
});

describe("guest persistence guard", () => {
  it("canPersistGuestData: signed out, loaded, and loaded in the current epoch", () => {
    const guest = { isAuthenticated: false, sessionEpoch: 2 };
    expect(canPersistGuestData({ guestDataLoaded: true, guestSessionEpoch: 2 }, guest)).toBe(true);
    expect(canPersistGuestData({ guestDataLoaded: true, guestSessionEpoch: 0 }, guest)).toBe(false);
    expect(canPersistGuestData({ guestDataLoaded: false, guestSessionEpoch: 2 }, guest)).toBe(false);
    expect(canPersistGuestData({ guestDataLoaded: true, guestSessionEpoch: 2 }, { ...guest, isAuthenticated: true })).toBe(false);
  });

  it("account data left in the store after logout never reaches guest storage", async () => {
    seedGuestStorage();
    setActivePinia(createPinia());
    const auth = useAuthStore();
    const store = useTaskStore();
    setupTaskStoreSubscribers();
    store.loadGuestData(); // guest first (guestDataLoaded = true)

    // Sign in; the account's categories fail to load, so guestDataLoaded stays true (legacy gap).
    api.routes.push((call) => (call.url === "/categories" ? { status: 500 } : undefined));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await auth.login({ email: "a@b.c", password: "pw" })).toBe(true);
    await store.initializeData();
    expect(store.guestDataLoaded).toBe(true);
    api.tasks.push({ ...guestTask("server-task-0", "Account task"), categoryId: CATEGORY.id });
    await store.fetchTasksForRange(WEEK);
    expect(store.tasks.map((t) => t.title)).toEqual(["Account task"]);

    // Logged out; before guest data is reloaded the store changes (e.g. a loading flag).
    await auth.logout();
    store.isLoadingToday = !store.isLoadingToday;
    await flush();
    expect(storedGuestTasks().map((t) => t.title)).toEqual(["Guest plan from before"]);

    // Guest data reloaded in the new epoch: saving works again.
    await store.initializeData();
    await store.addTask({ title: "Guest task", start: "2026-10-07T07:00:00.000Z", duration: 1, categoryId: OTHER.id });
    await flush();
    expect(storedGuestTasks().map((t) => t.title)).toEqual(["Guest plan from before", "Guest task"]);
  });

  it("a guest whose 401 clears nothing keeps saving (the epoch only moves when a session ends)", async () => {
    seedGuestStorage();
    setActivePinia(createPinia());
    const auth = useAuthStore();
    const store = useTaskStore();
    setupTaskStoreSubscribers();
    store.loadGuestData();

    api.routes.push((call) => (call.url === "/auth/login" ? { status: 401 } : undefined));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await auth.login({ email: "a@b.c", password: "wrong" })).toBe(false);
    expect(auth.lastError).toEqual({ status: 401 });

    await store.addTask({ title: "Guest task", start: "2026-10-07T07:00:00.000Z", duration: 1, categoryId: OTHER.id });
    await flush();
    expect(storedGuestTasks().map((t) => t.title)).toEqual(["Guest plan from before", "Guest task"]);
  });
});

describe("the owner's scenario", () => {
  /** Hours later: the access token has expired and the API was unloaded. */
  function idleForHours(): void {
    api.validAccessTokens.clear();
  }

  it("fully cold: expired token → slow create → logout → guest create → server wakes → still guest", async () => {
    seedGuestStorage();
    const { auth, store, ui } = await bootSignedIn();
    idleForHours();
    api.cold = true;

    const created = store.addTask({ title: "Account task 2", start: START, duration: 1, categoryId: CATEGORY.id });
    await until(() => api.heldCount === 1);

    await logoutAndRedirect(fakeRouter); // instant, although the server is cold
    expect(auth.status).toBe("guest");
    expect(await created).toBeNull();

    const guest = await store.addTask({
      title: "Guest task",
      start: "2026-10-07T07:00:00.000Z",
      duration: 1,
      categoryId: store.otherCategory!.id,
    });
    expect(guest).not.toBeNull();

    api.wake();
    await flush();

    expect(auth.status).toBe("guest");
    expect(auth.accessToken).toBeNull();
    expect(storage.has("accessToken")).toBe(false);
    expect(storage.has("refreshToken")).toBe(false);
    expect(store.tasks.map((t) => t.title)).toEqual(["Guest plan from before", "Guest task"]);
    expect(storedGuestTasks().map((t) => t.title)).toEqual(["Guest plan from before", "Guest task"]);
    expect(storage.get(CATEGORIES_KEY)).not.toContain(CATEGORY.id);
    expect(api.storedRefreshToken).toBeNull(); // revoked server-side
    expect(api.find("POST", "/tasks")).toHaveLength(1); // never retried
    expect(ui.toast.type === "error" && ui.toast.isVisible).toBe(false);
    expect(routerPush).not.toHaveBeenCalled(); // no "session expired" detour
  });

  it("refresh pending at logout (the confirmed root cause): new tokens are discarded and revoked", async () => {
    seedGuestStorage();
    const { auth, store, ui } = await bootSignedIn();
    idleForHours();
    const oldRefresh = auth.refreshToken!;
    // The create gets its 401 quickly; from then on the server is cold.
    api.hold = (call) => call.url.startsWith("/auth/");

    const created = store.addTask({ title: "Account task 2", start: START, duration: 1, categoryId: CATEGORY.id });
    await until(() => api.find("POST", "/auth/refresh").length === 1);
    await flushMicrotasks();

    await logoutAndRedirect(fakeRouter);
    expect(await created).toBeNull(); // rejected at once, silently
    await store.addTask({ title: "Guest task", start: "2026-10-07T07:00:00.000Z", duration: 1, categoryId: store.otherCategory!.id });

    api.wake(); // refresh succeeds server-side (rotating the token), then the logout with the old token
    await until(() => api.find("POST", "/auth/logout").length === 2);
    await flush();

    expect(auth.status).toBe("guest");
    expect(auth.accessToken).toBeNull();
    expect(auth.refreshToken).toBeNull();
    expect(storage.has("accessToken")).toBe(false);
    expect(store.tasks.map((t) => t.title)).toEqual(["Guest plan from before", "Guest task"]);
    expect(storedGuestTasks().map((t) => t.title)).toEqual(["Guest plan from before", "Guest task"]);
    expect(storedGuestTasks().some((t) => t.categoryId === CATEGORY.id)).toBe(false);

    const revoked = api.find("POST", "/auth/logout").map((c) => (c.body as { refreshToken: string }).refreshToken);
    expect(revoked[0]).toBe(oldRefresh);
    expect(revoked[1]).not.toBe(oldRefresh); // the rotated, stray token
    expect(api.storedRefreshToken).toBeNull(); // nothing left that could sign the user back in
    expect(api.find("POST", "/tasks")).toHaveLength(1);
    expect(ui.toast.type === "error" && ui.toast.isVisible).toBe(false);
    expect(routerPush).not.toHaveBeenCalled();
  });
});
