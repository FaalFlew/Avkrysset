/**
 * Org tasks in "my planner" (D7, Q3):
 * - read-only tasks (assigned by an admin) never start a pointer drag/resize/long-press and
 *   refuse keyboard moves (onBlocked); a drag attempt (mouse past the threshold, touch held for
 *   the long-press delay) is reported once (onDragBlocked) and is not a click;
 * - the overlap pre-check covers assigned org tasks for PERSONAL moves, and never runs for org
 *   tasks themselves.
 * Node environment: elements and events are minimal fakes (no jsdom in this project).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { findConflict, useKeyboardTaskMoves, useTaskDragAndDrop } from "../useTaskDragAndDrop";
import { canEditTask, overlapMessage } from "@/lib/taskAccess";
import { combineDateAndTime, weekDaysOf } from "@/lib/datetime";
import type { Task, TaskCapabilities } from "@/types";

const READ_ONLY: TaskCapabilities = { canEdit: false, canDelete: false, canReassign: false };
const EDITABLE: TaskCapabilities = { canEdit: true, canDelete: true, canReassign: false };

function makeTask(id: string, start: string, extra: Partial<Task> = {}): Task {
  return { id, title: id, start, duration: 1, categoryId: "c", categoryName: "", categoryColor: "", ...extra };
}
const org = (capabilities: TaskCapabilities): Partial<Task> => ({
  organizationId: "org-1",
  organizationName: "Acme",
  capabilities,
});

const DAY = "2026-10-07";
const personal = makeTask("personal", combineDateAndTime(DAY, "09:00"));
const assigned = makeTask("assigned", combineDateAndTime(DAY, "11:00"), org(READ_ONLY));
const ownOrg = makeTask("own-org", combineDateAndTime(DAY, "13:00"), org(EDITABLE));

const saved: Record<string, unknown> = {};
const htmlClasses = new Set<string>();

beforeEach(() => {
  vi.useFakeTimers();
  htmlClasses.clear();
  for (const key of ["window", "document", "requestAnimationFrame", "cancelAnimationFrame"]) {
    saved[key] = (globalThis as Record<string, unknown>)[key];
  }
  const win = new EventTarget();
  Object.assign(globalThis, {
    window: Object.assign(win, {
      setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
      clearTimeout: (id: number) => clearTimeout(id),
      innerWidth: 1440,
    }),
    document: {
      documentElement: {
        classList: { add: (c: string) => void htmlClasses.add(c), remove: (c: string) => void htmlClasses.delete(c) },
      },
    },
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  });
});

afterEach(() => {
  vi.useRealTimers();
  Object.assign(globalThis, saved);
});

describe("pointer drags", () => {
  function setup() {
    const scroller = ref({
      scrollTop: 0,
      scrollLeft: 0,
      clientWidth: 1200,
      getBoundingClientRect: () => ({ left: 0, right: 1440, top: 100, bottom: 900, width: 1440, height: 800 }),
    } as unknown as HTMLElement);
    const commit = vi.fn(async () => true);
    const onDragBlocked = vi.fn();
    const scope = effectScope();
    const drag = scope.run(() =>
      useTaskDragAndDrop({
        scroller,
        columns: () => [],
        days: () => weekDaysOf(DAY),
        topInset: () => 56,
        leftInset: () => 48,
        tasks: () => [personal, assigned, ownOrg],
        commit,
        onConflict: () => {},
        canDrag: (task) => canEditTask(task),
        onDragBlocked,
      })
    )!;
    return { drag, commit, onDragBlocked, scope };
  }

  const move = (x: number, y: number, type = "pointermove") =>
    window.dispatchEvent(Object.assign(new Event(type), { pointerId: 7, clientX: x, clientY: y }));

  function press(pointerType: "touch" | "mouse") {
    const block = { setPointerCapture: vi.fn(), hasPointerCapture: () => false, releasePointerCapture: vi.fn() };
    return {
      pointerType,
      pointerId: 7,
      button: 0,
      isPrimary: true,
      clientX: 400,
      clientY: 300,
      currentTarget: block,
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as PointerEvent & { stopPropagation: ReturnType<typeof vi.fn>; preventDefault: ReturnType<typeof vi.fn> };
  }

  it("a long-press on a read-only task does not start a drag (touch scrolling stays native)", () => {
    const { drag, scope } = setup();
    const event = press("touch");
    drag.onPointerDown(assigned, event);
    expect(event.stopPropagation).not.toHaveBeenCalled(); // the grid's swipe/tap handling still sees it
    vi.advanceTimersByTime(1000);
    expect(drag.dragTaskId.value).toBeNull();
    expect(drag.ghost.value).toBeNull();
    scope.stop();
  });

  it("a resize-handle press on a read-only task is ignored", () => {
    const { drag, scope } = setup();
    const event = press("mouse");
    drag.onPointerDown(assigned, event, "bottom");
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    window.dispatchEvent(Object.assign(new Event("pointermove"), { pointerId: 7, clientX: 400, clientY: 400 }));
    vi.advanceTimersByTime(100);
    expect(drag.dragTaskId.value).toBeNull();
    scope.stop();
  });

  it("a mouse drag attempt on a read-only task is reported once, shows 'not allowed' and is not a click", () => {
    const { drag, onDragBlocked, scope } = setup();
    drag.onPointerDown(assigned, press("mouse"));
    move(402, 301); // under the 4px threshold: still a click
    expect(onDragBlocked).not.toHaveBeenCalled();
    move(400, 320);
    move(400, 360);
    move(410, 400);
    expect(onDragBlocked).toHaveBeenCalledTimes(1);
    expect(onDragBlocked).toHaveBeenCalledWith(assigned);
    expect(htmlClasses.has("is-drag-blocked")).toBe(true);
    move(410, 400, "pointerup");
    expect(htmlClasses.has("is-drag-blocked")).toBe(false);
    expect(drag.consumeClickSuppression()).toBe(true); // the release doesn't open the editor
    expect(drag.dragTaskId.value).toBeNull();
    scope.stop();
  });

  it("a plain click on a read-only task is not a drag attempt (the read-only view opens)", () => {
    const { drag, onDragBlocked, scope } = setup();
    drag.onPointerDown(assigned, press("mouse"));
    move(401, 300, "pointerup");
    expect(onDragBlocked).not.toHaveBeenCalled();
    expect(drag.consumeClickSuppression()).toBe(false);
    scope.stop();
  });

  it("touch: holding a read-only task is a drag attempt; scrolling over it is not", () => {
    const { drag, onDragBlocked, scope } = setup();
    drag.onPointerDown(assigned, press("touch"));
    vi.advanceTimersByTime(360);
    expect(onDragBlocked).toHaveBeenCalledTimes(1);
    move(400, 300, "pointerup");
    expect(drag.consumeClickSuppression()).toBe(true);

    onDragBlocked.mockClear();
    drag.onPointerDown(assigned, press("touch"));
    move(400, 330); // finger moves at once: a scroll/swipe
    vi.advanceTimersByTime(1000);
    expect(onDragBlocked).not.toHaveBeenCalled();
    move(400, 330, "pointercancel");
    scope.stop();
  });

  it("editable tasks never report a blocked drag", () => {
    const { drag, onDragBlocked, scope } = setup();
    drag.onPointerDown(ownOrg, press("mouse"));
    move(400, 360);
    expect(onDragBlocked).not.toHaveBeenCalled();
    drag.cancel();
    scope.stop();
  });

  it("editable org tasks and personal tasks still drag", () => {
    const { drag, scope } = setup();
    drag.onPointerDown(ownOrg, press("touch"));
    vi.advanceTimersByTime(400);
    expect(drag.dragTaskId.value).toBe("own-org");
    drag.cancel();
    drag.onPointerDown(personal, press("touch"));
    vi.advanceTimersByTime(400);
    expect(drag.dragTaskId.value).toBe("personal");
    drag.cancel();
    scope.stop();
  });
});

describe("keyboard moves", () => {
  function setup(tasks: Task[]) {
    const commit = vi.fn(async () => true);
    const onConflict = vi.fn();
    const onBlocked = vi.fn();
    const scope = effectScope();
    const moves = scope.run(() =>
      useKeyboardTaskMoves({
        days: () => weekDaysOf(DAY),
        tasks: () => tasks,
        commit,
        onConflict,
        canMove: canEditTask,
        onBlocked,
      })
    )!;
    return { moves, commit, onConflict, onBlocked, scope };
  }

  it("read-only tasks refuse every step and say why", async () => {
    const { moves, commit, onBlocked, scope } = setup([personal, assigned]);
    for (const move of ["later", "earlier", "longer", "shorter", "nextDay", "prevWeek"] as const) {
      expect(moves.step(assigned, move)).toBe(false);
    }
    expect(onBlocked).toHaveBeenCalledTimes(6);
    expect(onBlocked).toHaveBeenCalledWith(assigned);
    expect(moves.overrides.value).toEqual({});
    await vi.advanceTimersByTimeAsync(1000);
    expect(commit).not.toHaveBeenCalled();
    scope.stop();
  });

  it("a personal task moved onto an assigned org task is reverted without an API call", async () => {
    // 09:00 → 11:00 (two hours of ↓) lands on the assigned 11:00 task.
    const { moves, commit, onConflict, scope } = setup([personal, assigned]);
    for (let i = 0; i < 8; i += 1) expect(moves.step(personal, "later")).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(onConflict).toHaveBeenCalledTimes(1);
    // The conflicting task is passed on, so the view can use the server's org wording.
    expect((onConflict.mock.calls[0] as unknown as [Task, Task])[1]).toBe(assigned);
    expect(overlapMessage((onConflict.mock.calls[0] as unknown as [Task, Task])[1])).toBe(
      "This time overlaps a task assigned to you in Acme."
    );
    expect(commit).not.toHaveBeenCalled();
    expect(moves.overrides.value).toEqual({});
    scope.stop();
  });

  it("an editable org task may be moved onto a personal task (no pre-check; lanes show both)", async () => {
    // 13:00 → 09:00 (16 × ↑) lands on the personal 09:00 task.
    const { moves, commit, onConflict, scope } = setup([personal, assigned, ownOrg]);
    for (let i = 0; i < 16; i += 1) expect(moves.step(ownOrg, "earlier")).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(onConflict).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    expect((commit.mock.calls[0] as unknown as [Task])[0].start).toBe(personal.start);
    scope.stop();
  });
});

describe("findConflict (Q3)", () => {
  it("personal tasks conflict with assigned org tasks", () => {
    const moved = { ...personal, start: combineDateAndTime(DAY, "11:30") };
    expect(findConflict(moved, [personal, assigned, ownOrg])?.id).toBe("assigned");
  });

  it("org tasks never trigger the check on themselves", () => {
    const movedAssigned = { ...assigned, start: personal.start };
    const movedOwn = { ...ownOrg, start: personal.start };
    expect(findConflict(movedAssigned, [personal, assigned, ownOrg])).toBeUndefined();
    expect(findConflict(movedOwn, [personal, assigned, ownOrg])).toBeUndefined();
  });

  it("touching tasks don't conflict (half-open, same as the server)", () => {
    const moved = { ...personal, start: combineDateAndTime(DAY, "10:00") };
    expect(findConflict(moved, [personal, assigned])).toBeUndefined();
  });
});
