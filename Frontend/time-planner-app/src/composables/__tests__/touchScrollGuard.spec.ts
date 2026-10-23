/**
 * Touch scroll guard: the task block registers a NON-passive touchmove listener up front (so the
 * browser gives it cancelable touchmoves for the whole sequence), and it calls preventDefault()
 * only while a long-pressed touch drag of that block is active. Node environment: elements and
 * events are minimal fakes (no jsdom in this project).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import {
  attachTouchScrollGuard,
  isTouchDragTarget,
  setTouchDragTarget,
  useTaskDragAndDrop,
  type TouchGuardTarget,
} from "../useTaskDragAndDrop";
import type { Task } from "@/types";

interface Registration {
  type: string;
  listener: EventListener;
  options?: AddEventListenerOptions;
}

/** Element stand-in that records listener registrations. */
function fakeElement() {
  const registrations: Registration[] = [];
  const el = {
    registrations,
    addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions) {
      registrations.push({ type, listener, options });
    },
    removeEventListener(type: string, listener: EventListener) {
      const i = registrations.findIndex((r) => r.type === type && r.listener === listener);
      if (i !== -1) registrations.splice(i, 1);
    },
    dispatchEvent: () => true,
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => false,
    releasePointerCapture: vi.fn(),
  };
  return el;
}

function touchmove(cancelable = true) {
  return { type: "touchmove", cancelable, preventDefault: vi.fn() } as unknown as Event & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

function fire(el: ReturnType<typeof fakeElement>, event: Event) {
  for (const r of el.registrations.filter((r) => r.type === "touchmove")) r.listener(event);
}

afterEach(() => setTouchDragTarget(null));

describe("attachTouchScrollGuard", () => {
  it("registers a non-passive touchmove listener and detaches it", () => {
    const el = fakeElement();
    const detach = attachTouchScrollGuard(el as unknown as TouchGuardTarget);
    expect(el.registrations).toHaveLength(1);
    expect(el.registrations[0]!.type).toBe("touchmove");
    expect(el.registrations[0]!.options).toEqual({ passive: false });
    detach();
    expect(el.registrations).toHaveLength(0);
  });

  it("blocks scrolling only while its element is the active touch-drag target", () => {
    const el = fakeElement();
    const other = fakeElement();
    attachTouchScrollGuard(el as unknown as TouchGuardTarget);

    const idle = touchmove();
    fire(el, idle);
    expect(idle.preventDefault).not.toHaveBeenCalled(); // normal scrolling / taps untouched

    setTouchDragTarget(other as unknown as EventTarget);
    const otherDrag = touchmove();
    fire(el, otherDrag);
    expect(otherDrag.preventDefault).not.toHaveBeenCalled();

    setTouchDragTarget(el as unknown as EventTarget);
    const dragging = touchmove();
    fire(el, dragging);
    expect(dragging.preventDefault).toHaveBeenCalledTimes(1);

    const uncancelable = touchmove(false);
    fire(el, uncancelable);
    expect(uncancelable.preventDefault).not.toHaveBeenCalled();
  });
});

describe("long-press drag drives the guard", () => {
  const saved: Record<string, unknown> = {};

  beforeEach(() => {
    vi.useFakeTimers();
    for (const key of ["window", "document", "requestAnimationFrame", "cancelAnimationFrame"]) {
      saved[key] = (globalThis as Record<string, unknown>)[key];
    }
    const win = new EventTarget();
    Object.assign(globalThis, {
      window: Object.assign(win, {
        setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
        clearTimeout: (id: number) => clearTimeout(id),
        innerWidth: 375,
      }),
      document: { documentElement: { classList: { add: () => {}, remove: () => {} } } },
      requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16),
      cancelAnimationFrame: (id: number) => clearTimeout(id),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.assign(globalThis, saved);
  });

  it("the block's guard starts blocking when the long-press fires and stops when the drag ends", () => {
    const block = fakeElement();
    attachTouchScrollGuard(block as unknown as TouchGuardTarget); // at mount, before any touch

    const scroller = ref({
      scrollTop: 0,
      scrollLeft: 0,
      clientWidth: 327,
      getBoundingClientRect: () => ({ left: 0, right: 375, top: 100, bottom: 700, width: 375, height: 600 }),
    } as unknown as HTMLElement);
    const task: Task = {
      id: "t1", title: "Deep work", start: "2026-10-05T07:00:00.000Z", duration: 1,
      categoryId: "c", categoryName: "", categoryColor: "",
    };
    const scope = effectScope();
    const drag = scope.run(() =>
      useTaskDragAndDrop({
        scroller,
        columns: () => [],
        days: () => ["2026-10-05"],
        topInset: () => 56,
        leftInset: () => 48,
        tasks: () => [task],
        commit: async () => true,
        onConflict: () => {},
      })
    )!;

    drag.onPointerDown(task, {
      pointerType: "touch", pointerId: 7, button: 0, isPrimary: true, clientX: 200, clientY: 300,
      currentTarget: block, stopPropagation: () => {}, preventDefault: () => {},
    } as unknown as PointerEvent);

    // Before the long-press fires: scrolling is not blocked.
    const early = touchmove();
    fire(block, early);
    expect(early.preventDefault).not.toHaveBeenCalled();

    vi.advanceTimersByTime(360); // long-press (350ms) fires
    expect(drag.dragTaskId.value).toBe("t1");
    expect(isTouchDragTarget(block as unknown as EventTarget)).toBe(true);
    const vertical = touchmove();
    fire(block, vertical);
    expect(vertical.preventDefault).toHaveBeenCalledTimes(1); // straight up/down drags now work

    drag.cancel();
    expect(isTouchDragTarget(block as unknown as EventTarget)).toBe(false);
    const after = touchmove();
    fire(block, after);
    expect(after.preventDefault).not.toHaveBeenCalled();
    scope.stop();
  });
});
