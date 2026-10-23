// src/composables/useTaskDragAndDrop.ts — move/resize tasks on the planner grid with pointer
// events (mouse, pen, touch) and with the keyboard.
//
// Geometry is wall-clock grid minutes (what the rows show): a drop on a DST day lands on the
// slot under the pointer (shiftStartWallClock: a press that does not move keeps the exact start,
// and a DST gap or repeated hour never makes a move go the wrong way); keyboard steps use elapsed
// time (stepStartElapsed). Durations stay elapsed hours.
// 1px = 1 minute (HOUR_HEIGHT / 60).
//
// Pointer drag:
// - Mouse/pen: a press becomes a drag after 4px of movement.
// - Touch: long-press (350ms, cancelled by > 8px of movement so the page can scroll or the
//   phone day-swipe can take over). While the drag runs, the block's own non-passive touchmove
//   guard (attachTouchScrollGuard, registered at mount so it exists at touchstart) calls
//   preventDefault() so the page does not scroll in any direction. Resizing on touch happens in
//   the editor.
// - The target day is taken from the column rects at the pointer X, clamped to the visible days,
//   so leaving the grid never resets it. Start is clamped to 00:00–23:45. Auto-scroll near the
//   scroller edges; updates are rAF-throttled; Esc cancels.
// - Drop: listeners are removed immediately. A drop onto another task (same half-open rule as
//   the server) reverts without an API call and calls `onConflict`. Otherwise the ghost stays at
//   its new position (is-saving) while `commit` runs; on failure the task snaps back (the store
//   toasts the reason).
// - Cross-week: holding a dragged task near the grid's left/right edge (EDGE_ZONE_PX) asks the
//   view to show the previous/next week (day on phones) after 600ms, then every 900ms
//   (`onEdgeAdvance`). The drag survives the navigation; the drop lands on the day under the
//   pointer at the same wall-clock time (`atMinutesOfDay`, DST-safe). An edge that the drag
//   *starts* in stays disarmed until the pointer leaves it, so grabbing a Monday task near its
//   left side never flips the week by accident.
// - Releasing outside the grid, Esc or pointercancel cancels; `onCancel` lets the view return
//   to the origin week.

import { getCurrentScope, onScopeDispose, ref, shallowRef, type Ref } from "vue";
import type { Task } from "@/types";
import { checksOverlap } from "@/lib/taskAccess";
import {
  addDays,
  addMinutes,
  atMinutesOfDay,
  diffCalendarDays,
  diffMinutes,
  endInstant,
  minutesSinceStartOfDay,
  moveToDate,
  overlaps,
  toDateKey,
  type DateKey,
  type UtcIsoString,
} from "@/lib/datetime";
import {
  AUTO_SCROLL_EDGE_PX,
  DRAG_THRESHOLD_PX,
  EDGE_FIRST_DELAY_MS,
  EDGE_REPEAT_MS,
  EDGE_ZONE_PX,
  HOUR_HEIGHT,
  KEYBOARD_COMMIT_DELAY_MS,
  LONG_PRESS_MS,
  LONG_PRESS_TOLERANCE_PX,
  MAX_DURATION_HOURS,
  MAX_START_MINUTES,
  PX_PER_MINUTE,
  SNAP_MINUTES,
} from "@/components/planner/gridConstants";

/** Height of one hour row in the week grid (1px = 1 minute). Kept for existing imports. */
export const PIXELS_PER_HOUR = HOUR_HEIGHT;

export type DragMode = "move" | "top" | "bottom";

export interface DragContext {
  /** The grid's scroll container. */
  scroller: Ref<HTMLElement | null>;
  /** Day column elements, in the order of `days()`. */
  columns: () => HTMLElement[];
  /** Visible days (DateKeys) in column order. */
  days: () => readonly DateKey[];
  /** Height (px) of the sticky header inside the scroller (for edge auto-scroll). */
  topInset: () => number;
  /** Width (px) of the sticky time gutter inside the scroller. */
  leftInset: () => number;
  /** Tasks to check for overlaps (the dragged task itself is skipped). */
  tasks: () => readonly Task[];
  /** Save the change; resolve true on success. */
  commit: (task: Task, original: Task, mode: DragMode) => Promise<boolean>;
  /** A drop/keyboard move would overlap `other` (reverted, no API call). */
  onConflict: (task: Task, other?: Task) => void;
  /** True while the visible week's tasks are still loading: the server's 409 decides overlaps. */
  isLoading?: () => boolean;
  /** Show the previous (-1) / next (+1) week (day on phones) while a task is held at an edge. */
  onEdgeAdvance?: (side: -1 | 1) => void;
  /** The drag was cancelled (Esc, pointercancel, released outside the grid). */
  onCancel?: (original: Task) => void;
  /** Whether this task may be dragged/resized (read-only org tasks may not). Default: yes. */
  canDrag?: (task: Task) => boolean;
  /**
   * Someone tried to drag a task `canDrag` refuses: a mouse/pen press moved past the drag
   * threshold, or a touch was held for the long-press delay. Called once per press.
   */
  onDragBlocked?: (task: Task) => void;
}

/** Edge-dwell state shown by the view: which edge, how many advances so far, ms until the next. */
export interface EdgeCue {
  side: -1 | 1;
  /** Increments on every advance (restart the progress animation). */
  cycle: number;
  /** Time until the next advance, for the progress indicator. */
  durationMs: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function sameSlot(a: Task, b: Task): boolean {
  return a.start === b.start && Math.abs(a.duration - b.duration) < 1e-9;
}

/** Whether `task` overlaps any other task in `others` (same half-open rule as the server). */
export function findConflict(task: Task, others: readonly Task[]): Task | undefined {
  // Org tasks may overlap anything (Q3: admins assign without seeing personal calendars); a
  // personal task must not overlap any other task, including org tasks assigned to me.
  if (!checksOverlap(task)) return undefined;
  return others.find(
    (other) => other.id !== task.id && overlaps(task.start, task.duration, other.start, other.duration)
  );
}

// ------------------------------------------------------------------------------------
// Pure start-time math (exported for tests). DST-safe in both directions.
// ------------------------------------------------------------------------------------

/**
 * Pointer geometry: the start `deltaMinutes` of wall clock (grid rows) away from `start`, on
 * `targetDay` (default: the start's own day), clamped to 00:00–23:45.
 * - No movement (delta 0, same day) keeps `start` exactly — re-resolving a time in the repeated
 *   fall-back hour would otherwise jump to its first occurrence.
 * - On the start's own day the result always moves in the direction of `deltaMinutes`: when the
 *   wall-clock slot falls into a spring-forward gap (shifted forward by the DST policy) or into
 *   the repeated hour (earlier occurrence), it falls back to elapsed time (`start ± delta`).
 */
export function shiftStartWallClock(
  start: UtcIsoString,
  deltaMinutes: number,
  targetDay?: DateKey
): UtcIsoString {
  const day = toDateKey(start);
  const target = targetDay ?? day;
  if (target === day && deltaMinutes === 0) return start;

  const minutes = clamp(minutesSinceStartOfDay(start) + deltaMinutes, 0, MAX_START_MINUTES);
  const candidate = atMinutesOfDay(target, minutes);
  if (target !== day) return candidate;

  const moved = diffMinutes(candidate, start);
  if (Math.sign(moved) === Math.sign(deltaMinutes)) return candidate;
  // DST made the wall-clock slot move the wrong way (or not at all): use elapsed time instead,
  // as long as it stays on the same day and within 00:00–23:45.
  const elapsed = addMinutes(start, deltaMinutes);
  if (toDateKey(elapsed) === day && minutesSinceStartOfDay(elapsed) <= MAX_START_MINUTES) return elapsed;
  return start;
}

/**
 * Keyboard step: `start ± minutes` of elapsed time, so ↑ always moves earlier and ↓ always later
 * (also across DST gaps and through the repeated hour). Returns `null` at the day's edges
 * (before 00:00 or after 23:45 of the start's day).
 */
export function stepStartElapsed(start: UtcIsoString, deltaMinutes: number): UtcIsoString | null {
  const next = addMinutes(start, deltaMinutes);
  if (toDateKey(next) !== toDateKey(start)) return null;
  if (minutesSinceStartOfDay(next) > MAX_START_MINUTES) return null;
  return next;
}

// ------------------------------------------------------------------------------------
// Touch scroll guard (exported for TaskBlock and tests).
// ------------------------------------------------------------------------------------

/**
 * The element whose touch sequence drives the active (long-pressed) task drag, if any.
 *
 * Browsers decide at `touchstart` whether a touch sequence may block scrolling: only
 * non-passive `touchmove` listeners that already exist on the touched element's path get
 * cancelable touchmoves (Chrome hit-tests "blocking" handler regions at touchstart; iOS Safari
 * likewise honours listeners registered before the first move). A listener added when the
 * long-press fires is too late — a vertical move then starts a native pan (allowed by the block's
 * `touch-action: pan-y`) and the drag dies with pointercancel. So every task block registers
 * `attachTouchScrollGuard` at mount, and the guard blocks scrolling only while this is its block.
 */
let touchDragTarget: EventTarget | null = null;

export function setTouchDragTarget(target: EventTarget | null): void {
  touchDragTarget = target;
}

export function isTouchDragTarget(target: EventTarget | null): boolean {
  return target !== null && target === touchDragTarget;
}

/** What attachTouchScrollGuard needs from an element (an HTMLElement in the app). */
export interface TouchGuardTarget extends EventTarget {
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener): void;
}

/**
 * Register a non-passive `touchmove` listener on `el` that calls preventDefault() only while a
 * touch drag of `el` is active — never for taps, never for normal scrolling, never on touchstart.
 * Returns the detach function.
 */
export function attachTouchScrollGuard(el: TouchGuardTarget): () => void {
  const listener: EventListener = (event) => {
    if (event.cancelable && isTouchDragTarget(el)) event.preventDefault();
  };
  el.addEventListener("touchmove", listener, { passive: false });
  return () => el.removeEventListener("touchmove", listener);
}

// ------------------------------------------------------------------------------------
// Pure cross-week helpers (exported for tests).
// ------------------------------------------------------------------------------------

export type EdgeSide = -1 | 0 | 1;

/** Horizontal extent of the day columns: from the end of the time gutter to the grid's right edge. */
export interface EdgeBounds {
  left: number;
  right: number;
}

/** Which edge zone `x` is in: -1 left (or beyond it), 1 right (or beyond it), 0 neither. */
export function edgeZoneAt(x: number, bounds: EdgeBounds, zone: number = EDGE_ZONE_PX): EdgeSide {
  if (bounds.right - bounds.left <= 2 * zone) {
    // Very narrow grid: only "beyond the edge" counts, so the middle stays usable.
    if (x < bounds.left) return -1;
    if (x > bounds.right) return 1;
    return 0;
  }
  if (x <= bounds.left + zone) return -1;
  if (x >= bounds.right - zone) return 1;
  return 0;
}

export interface DwellState {
  /** Edge the pointer is dwelling at (0 = none). */
  side: EdgeSide;
  /** When the dwell at `side` began (ms). */
  since: number;
  /** Advances already fired during this dwell. */
  fired: number;
  /** An edge the drag started in: ignored until the pointer leaves it once. */
  disarmed: EdgeSide;
}

export function initialDwell(startSide: EdgeSide = 0): DwellState {
  return { side: 0, since: 0, fired: 0, disarmed: startSide };
}

/**
 * Advance the edge-dwell timer to time `now` with the pointer in zone `zone`. Returns the next
 * state and whether to show the previous/next week now: first after `firstDelay` ms in a zone,
 * then every `repeat` ms while the pointer stays there. Leaving the zone resets it.
 */
export function advanceDwell(
  state: DwellState,
  zone: EdgeSide,
  now: number,
  firstDelay: number = EDGE_FIRST_DELAY_MS,
  repeat: number = EDGE_REPEAT_MS
): { state: DwellState; fire: boolean } {
  let disarmed = state.disarmed;
  if (disarmed !== 0 && zone !== disarmed) disarmed = 0;
  const effective: EdgeSide = zone === disarmed ? 0 : zone;
  if (effective === 0) return { state: { side: 0, since: 0, fired: 0, disarmed }, fire: false };
  if (effective !== state.side) {
    return { state: { side: effective, since: now, fired: 0, disarmed }, fire: false };
  }
  const due = state.since + firstDelay + state.fired * repeat;
  if (now >= due) return { state: { ...state, disarmed, fired: state.fired + 1 }, fire: true };
  return { state: { ...state, disarmed }, fire: false };
}

/** A pointer released outside the grid's rectangle cancels the drag. */
export function isOutsideRect(
  x: number,
  y: number,
  rect: { left: number; right: number; top: number; bottom: number }
): boolean {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

interface Session {
  task: Task;
  mode: DragMode;
  pointerId: number;
  pointerType: string;
  target: HTMLElement;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startScrollTop: number;
  originDay: DateKey;
  originEnd: UtcIsoString;
  active: boolean;
  longPressTimer: number | undefined;
  frame: number | undefined;
  autoScrollFrame: number | undefined;
  /** Edge-dwell timer for cross-week dragging. */
  dwell: DwellState;
  /** Visible days when last laid out (re-run the geometry when the view navigates). */
  daysKey: string;
}

/** Where the dragged task came from: the view keeps its DOM node mounted in that column. */
export interface DragOrigin {
  task: Task;
  columnIndex: number;
}

export function useTaskDragAndDrop(ctx: DragContext) {
  /** Live preview of the dragged task (also kept while saving). */
  const ghost = shallowRef<Task | null>(null);
  /** Id of the task being dragged or saved. */
  const dragTaskId = ref<string | null>(null);
  const dragMode = ref<DragMode | null>(null);
  /** The ghost overlaps another task. */
  const conflict = ref(false);
  /** The drop is being saved. */
  const isSaving = ref(false);
  /** The dragged task as it was, and its column (kept mounted so touch drags survive navigation). */
  const dragOrigin = shallowRef<DragOrigin | null>(null);
  /** Edge cue while a dragged task is held at the left/right edge (null otherwise). */
  const edge = shallowRef<EdgeCue | null>(null);

  let session: Session | null = null;
  let suppressClickUntil = 0;

  // ------------------------------------------------------------------ listeners
  const preventTouchScroll = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault();
  };

  function addListeners(): void {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeydown, true);
  }

  function removeListeners(): void {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    window.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("touchmove", preventTouchScroll);
  }

  function endSession(): void {
    if (!session) return;
    window.clearTimeout(session.longPressTimer);
    if (session.frame !== undefined) cancelAnimationFrame(session.frame);
    if (session.autoScrollFrame !== undefined) cancelAnimationFrame(session.autoScrollFrame);
    try {
      if (session.target.hasPointerCapture?.(session.pointerId)) {
        session.target.releasePointerCapture(session.pointerId);
      }
    } catch {
      /* element already gone */
    }
    if (isTouchDragTarget(session.target)) setTouchDragTarget(null);
    removeListeners();
    document.documentElement.classList.remove("is-dragging-task");
    edge.value = null;
    session = null;
  }

  function resetVisuals(): void {
    ghost.value = null;
    dragTaskId.value = null;
    dragMode.value = null;
    conflict.value = false;
    dragOrigin.value = null;
  }

  function edgeBounds(): (EdgeBounds & { top: number; bottom: number; rect: DOMRect }) | null {
    const scroller = ctx.scroller.value;
    if (!scroller) return null;
    const rect = scroller.getBoundingClientRect();
    return {
      left: rect.left + ctx.leftInset(),
      right: rect.left + scroller.clientWidth,
      top: rect.top,
      bottom: rect.bottom,
      rect,
    };
  }

  // ------------------------------------------------------------------ refused drags
  interface BlockedAttempt {
    task: Task;
    pointerId: number;
    isTouch: boolean;
    startX: number;
    startY: number;
    timer: number | undefined;
    fired: boolean;
  }
  let blocked: BlockedAttempt | null = null;

  function watchBlockedAttempt(task: Task, event: PointerEvent): void {
    if (!ctx.onDragBlocked) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!event.isPrimary) return;
    stopBlockedAttempt();
    const attempt: BlockedAttempt = {
      task,
      pointerId: event.pointerId,
      isTouch: event.pointerType === "touch",
      startX: event.clientX,
      startY: event.clientY,
      timer: undefined,
      fired: false,
    };
    blocked = attempt;
    if (attempt.isTouch) attempt.timer = window.setTimeout(() => fireBlocked(attempt), LONG_PRESS_MS);
    window.addEventListener("pointermove", onBlockedMove);
    window.addEventListener("pointerup", onBlockedEnd);
    window.addEventListener("pointercancel", onBlockedEnd);
  }

  function fireBlocked(attempt: BlockedAttempt): void {
    if (blocked !== attempt || attempt.fired) return;
    attempt.fired = true;
    // "Not allowed" cursor while the press lasts.
    if (!attempt.isTouch) document.documentElement.classList.add("is-drag-blocked");
    ctx.onDragBlocked?.(attempt.task);
  }

  function onBlockedMove(event: PointerEvent): void {
    const attempt = blocked;
    if (!attempt || event.pointerId !== attempt.pointerId) return;
    const distance = Math.hypot(event.clientX - attempt.startX, event.clientY - attempt.startY);
    if (attempt.isTouch) {
      // Moving before the long-press delay is scrolling/swiping: not a drag attempt.
      if (!attempt.fired && distance > LONG_PRESS_TOLERANCE_PX) stopBlockedAttempt();
      return;
    }
    if (distance >= DRAG_THRESHOLD_PX) fireBlocked(attempt);
  }

  function onBlockedEnd(event: PointerEvent): void {
    const attempt = blocked;
    if (!attempt || event.pointerId !== attempt.pointerId) return;
    stopBlockedAttempt();
    // A drag attempt is not a click: don't open the editor on release.
    if (attempt.fired) suppressClickUntil = performance.now() + 400;
  }

  function stopBlockedAttempt(): void {
    if (!blocked) return;
    window.clearTimeout(blocked.timer);
    blocked = null;
    window.removeEventListener("pointermove", onBlockedMove);
    window.removeEventListener("pointerup", onBlockedEnd);
    window.removeEventListener("pointercancel", onBlockedEnd);
    document.documentElement.classList.remove("is-drag-blocked");
  }

  // ------------------------------------------------------------------ start
  /**
   * Start a potential drag from a task block (`mode` 'move') or one of its resize handles.
   * Call from the element's `pointerdown`.
   */
  function onPointerDown(task: Task, event: PointerEvent, mode: DragMode = "move"): void {
    if (session || isSaving.value) return;
    // Read-only tasks: no drag, no resize, no long-press; the click still opens the (read-only)
    // editor and touch scrolling/swiping stays native. A press that turns into a drag attempt
    // is reported (onDragBlocked) so the view can say why nothing moves.
    if (ctx.canDrag && !ctx.canDrag(task)) {
      watchBlockedAttempt(task, event);
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!event.isPrimary) return;
    event.stopPropagation();

    const isTouch = event.pointerType === "touch";
    // Resize handles are mouse/pen affordances; on touch a press always means "move".
    const effectiveMode: DragMode = isTouch ? "move" : mode;
    if (mode !== "move" && !isTouch) {
      // A plain click on a resize handle must never open the editor.
      suppressClickUntil = Number.POSITIVE_INFINITY;
      event.preventDefault();
    }

    session = {
      task: { ...task },
      mode: effectiveMode,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      target: event.currentTarget as HTMLElement,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startScrollTop: ctx.scroller.value?.scrollTop ?? 0,
      originDay: toDateKey(task.start),
      originEnd: endInstant(task.start, task.duration),
      active: false,
      longPressTimer: undefined,
      frame: undefined,
      autoScrollFrame: undefined,
      dwell: initialDwell(),
      daysKey: ctx.days().join(","),
    };
    addListeners();

    if (isTouch) {
      const current = session;
      current.longPressTimer = window.setTimeout(() => {
        if (session !== current) return;
        // From now on the block's own guard (registered at mount, so it existed at touchstart and
        // its touchmoves are cancelable) blocks native scrolling for this touch sequence.
        setTouchDragTarget(current.target);
        // Backup only: a window listener added now usually receives non-cancelable touchmoves.
        window.addEventListener("touchmove", preventTouchScroll, { passive: false });
        try {
          current.target.setPointerCapture(current.pointerId);
        } catch {
          /* capture not available */
        }
        navigator.vibrate?.(10);
        activate();
      }, LONG_PRESS_MS);
    }
  }

  function activate(): void {
    if (!session || session.active) return;
    session.active = true;
    ghost.value = { ...session.task };
    dragTaskId.value = session.task.id;
    dragMode.value = session.mode;
    conflict.value = false;
    const days = ctx.days();
    const columnIndex = days.indexOf(session.originDay);
    dragOrigin.value = { task: { ...session.task }, columnIndex: columnIndex === -1 ? dayIndexAt(session.startX) : columnIndex };
    // An edge the drag starts in is ignored until the pointer leaves it.
    const bounds = edgeBounds();
    session.dwell = initialDwell(bounds && session.mode === "move" ? edgeZoneAt(session.startX, bounds) : 0);
    document.documentElement.classList.add("is-dragging-task");
    loopAutoScroll();
  }

  // ------------------------------------------------------------------ move
  function onPointerMove(event: PointerEvent): void {
    if (!session || event.pointerId !== session.pointerId) return;
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    const distance = Math.hypot(dx, dy);

    if (!session.active) {
      if (session.pointerType === "touch") {
        // Moving before the long-press fires means the user is scrolling.
        if (distance > LONG_PRESS_TOLERANCE_PX) cancelPending();
        return;
      }
      if (distance < DRAG_THRESHOLD_PX) return;
      activate();
    }
    // (preventDefault on pointermove does not stop touch scrolling — the block's touchmove guard
    // does; this only keeps mouse/pen moves from doing anything else.)
    if (event.cancelable) event.preventDefault();
    scheduleUpdate();
  }

  function scheduleUpdate(): void {
    if (!session || session.frame !== undefined) return;
    session.frame = requestAnimationFrame(() => {
      if (!session) return;
      session.frame = undefined;
      update();
    });
  }

  function dayIndexAt(x: number): number {
    const columns = ctx.columns();
    let index = 0;
    columns.forEach((column, i) => {
      if (x >= column.getBoundingClientRect().left) index = i;
    });
    return clamp(index, 0, Math.max(0, columns.length - 1));
  }

  function update(): void {
    if (!session || !session.active) return;
    const s = session;
    const scrollDelta = (ctx.scroller.value?.scrollTop ?? s.startScrollTop) - s.startScrollTop;
    const dy = s.lastY - s.startY + scrollDelta;
    const minuteDelta = Math.round(dy / PX_PER_MINUTE / SNAP_MINUTES) * SNAP_MINUTES;
    const next: Task = { ...s.task };

    if (s.mode === "bottom") {
      const minutes = clamp(s.task.duration * 60 + minuteDelta, SNAP_MINUTES, MAX_DURATION_HOURS * 60);
      next.duration = minutes / 60;
    } else if (s.mode === "top") {
      let start = shiftStartWallClock(s.task.start, minuteDelta);
      if (diffMinutes(s.originEnd, start) < SNAP_MINUTES) start = addMinutes(s.originEnd, -SNAP_MINUTES);
      next.start = start;
      next.duration = diffMinutes(s.originEnd, start) / 60;
    } else {
      const days = ctx.days();
      const day = days[dayIndexAt(s.lastX)] ?? s.originDay;
      next.start = shiftStartWallClock(s.task.start, minuteDelta, day);
    }

    const current = ghost.value;
    if (current && sameSlot(current, next)) return;
    ghost.value = next;
    conflict.value = !!findConflict(next, ctx.tasks());
  }

  function loopAutoScroll(): void {
    if (!session) return;
    const s = session;
    s.autoScrollFrame = requestAnimationFrame(() => {
      if (!session || session !== s || !s.active) return;
      const scroller = ctx.scroller.value;
      let scrolledSideways = false;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const top = rect.top + ctx.topInset();
        const left = rect.left + ctx.leftInset();
        let vy = 0;
        let vx = 0;
        if (s.lastY < top + AUTO_SCROLL_EDGE_PX) vy = -speed(top + AUTO_SCROLL_EDGE_PX - s.lastY);
        else if (s.lastY > rect.bottom - AUTO_SCROLL_EDGE_PX) vy = speed(s.lastY - (rect.bottom - AUTO_SCROLL_EDGE_PX));
        if (s.mode === "move") {
          if (s.lastX < left + AUTO_SCROLL_EDGE_PX) vx = -speed(left + AUTO_SCROLL_EDGE_PX - s.lastX);
          else if (s.lastX > rect.right - AUTO_SCROLL_EDGE_PX) vx = speed(s.lastX - (rect.right - AUTO_SCROLL_EDGE_PX));
        }
        if (vy !== 0 || vx !== 0) {
          const beforeTop = scroller.scrollTop;
          const beforeLeft = scroller.scrollLeft;
          scroller.scrollTop += vy;
          scroller.scrollLeft += vx;
          scrolledSideways = scroller.scrollLeft !== beforeLeft;
          if (scroller.scrollTop !== beforeTop || scrolledSideways) update();
        }
      }
      if (s.mode === "move") trackEdgeDwell(s, scrolledSideways);
      // The view navigated (edge advance): lay the ghost out on the new columns.
      const daysKey = ctx.days().join(",");
      if (daysKey !== s.daysKey) {
        s.daysKey = daysKey;
        update();
      }
      loopAutoScroll();
    });
  }

  /**
   * Cross-week dragging: a dragged task held at the left/right edge shows the previous/next week
   * (day on phones). While the grid can still scroll sideways that way, scrolling wins.
   */
  function trackEdgeDwell(s: Session, scrolledSideways: boolean): void {
    const bounds = edgeBounds();
    const zone: EdgeSide = !bounds || scrolledSideways || !ctx.onEdgeAdvance ? 0 : edgeZoneAt(s.lastX, bounds);
    const { state, fire } = advanceDwell(s.dwell, zone, performance.now());
    s.dwell = state;
    if (fire && state.side !== 0) ctx.onEdgeAdvance?.(state.side);

    const side = state.side;
    if (side === 0) {
      if (edge.value) edge.value = null;
      return;
    }
    const cycle = state.fired;
    if (!edge.value || edge.value.side !== side || edge.value.cycle !== cycle) {
      edge.value = { side, cycle, durationMs: cycle === 0 ? EDGE_FIRST_DELAY_MS : EDGE_REPEAT_MS };
    }
  }

  /** Pixels per frame, growing as the pointer goes deeper into (or past) the edge zone. */
  function speed(depth: number): number {
    return clamp(Math.round(depth / 3), 2, 24);
  }

  // ------------------------------------------------------------------ end
  function cancelPending(): void {
    endSession();
    if (suppressClickUntil === Number.POSITIVE_INFINITY) suppressClickUntil = 0;
  }

  /** Cancel the drag (Esc / pointercancel / released outside the grid) and restore the task. */
  function cancel(): void {
    if (!session) return;
    const wasActive = session.active;
    const original = session.task;
    endSession();
    if (wasActive || suppressClickUntil === Number.POSITIVE_INFINITY) {
      suppressClickUntil = performance.now() + 400;
    }
    if (wasActive) {
      resetVisuals();
      ctx.onCancel?.(original);
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (session && event.pointerId === session.pointerId) cancel();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !session) return;
    if (session.active) {
      event.preventDefault();
      event.stopPropagation();
    }
    cancel();
  }

  async function onPointerUp(event: PointerEvent): Promise<void> {
    if (!session || event.pointerId !== session.pointerId) return;
    const s = session;
    if (!s.active) {
      endSession();
      if (s.mode !== "move" && s.pointerType !== "touch") suppressClickUntil = performance.now() + 400;
      else if (suppressClickUntil === Number.POSITIVE_INFINITY) suppressClickUntil = 0;
      return;
    }

    // Released outside the grid: cancel (the view returns to the origin week).
    const bounds = edgeBounds();
    if (bounds && isOutsideRect(event.clientX, event.clientY, bounds.rect)) {
      cancel();
      return;
    }

    // Detach listeners right away: moving the pointer while the request is in flight must not
    // move the ghost any more.
    s.lastX = event.clientX;
    s.lastY = event.clientY;
    update();
    endSession();
    suppressClickUntil = performance.now() + 400;

    const final = ghost.value;
    const original = s.task;
    if (!final || sameSlot(final, original)) {
      resetVisuals();
      return;
    }
    // While the target week is still loading the client can't know its tasks: the server's 409
    // decides (the store toasts and reloads the week).
    const canCheck = !ctx.isLoading?.();
    const other = canCheck ? findConflict(final, ctx.tasks()) : undefined;
    if (canCheck && (other || conflict.value)) {
      resetVisuals();
      ctx.onConflict(final, other);
      return;
    }

    isSaving.value = true;
    try {
      await ctx.commit(final, original, s.mode);
    } finally {
      isSaving.value = false;
      resetVisuals();
    }
  }

  /** True (once) when a click right after a drag or on a resize handle should be ignored. */
  function consumeClickSuppression(): boolean {
    if (performance.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      return true;
    }
    return false;
  }

  if (getCurrentScope()) onScopeDispose(() => {
    endSession();
    stopBlockedAttempt();
    resetVisuals();
  });

  return {
    ghost,
    dragTaskId,
    dragMode,
    conflict,
    isSaving,
    dragOrigin,
    edge,
    onPointerDown,
    cancel,
    consumeClickSuppression,
  };
}

// ====================================================================================
// Keyboard moves on a focused task
// ====================================================================================

export type KeyboardMove =
  | "earlier"
  | "later"
  | "shorter"
  | "longer"
  | "prevDay"
  | "nextDay"
  | "prevWeek"
  | "nextWeek";

export interface KeyboardMoveContext {
  days: () => readonly DateKey[];
  tasks: () => readonly Task[];
  commit: (task: Task, original: Task) => Promise<boolean>;
  onConflict: (task: Task, other?: Task) => void;
  /** Called after every step with the new (uncommitted) position. */
  onStep?: (task: Task) => void;
  /** A step moved the task off the visible days: show the day (its week on ≥ 768px). */
  onNavigate?: (day: DateKey) => void;
  /** Whether this task may be moved/resized from the keyboard (read-only org tasks may not). */
  canMove?: (task: Task) => boolean;
  /** A step was refused because the task is read-only. */
  onBlocked?: (task: Task) => void;
}

/**
 * Calendar day a day/week step lands on (same weekday ±7 for weeks). Pure, DST-immune.
 */
export function keyboardTargetDay(day: DateKey, move: "prevDay" | "nextDay" | "prevWeek" | "nextWeek"): DateKey {
  const delta = { prevDay: -1, nextDay: 1, prevWeek: -7, nextWeek: 7 }[move];
  return addDays(day, delta);
}

/**
 * ↑/↓ move ±15 min, Shift+↑/↓ change the end ±15 min, ←/→ move ±1 day and PageUp/PageDown ±1
 * week — crossing week boundaries: when the task leaves the visible days, `onNavigate` shows its
 * new day. Day/week moves keep the wall-clock time (09:00 stays 09:00 across a DST change).
 * Moves render at once through `overrides` (optimistic) and commit after 500ms of idle time; a
 * conflicting final position or a failed save reverts.
 */
export function useKeyboardTaskMoves(ctx: KeyboardMoveContext) {
  /** Uncommitted positions by task id (render these instead of the store's values). */
  const overrides = shallowRef<Record<string, Task>>({});
  /** Ids whose final position is being saved. */
  const savingIds = shallowRef<Record<string, true>>({});
  const originals = new Map<string, Task>();
  const timers = new Map<string, number>();
  const versions = new Map<string, number>();

  function setOverride(id: string, task: Task | null): void {
    const next = { ...overrides.value };
    if (task) next[id] = task;
    else delete next[id];
    overrides.value = next;
  }

  function setSaving(id: string, saving: boolean): void {
    const next = { ...savingIds.value };
    if (saving) next[id] = true;
    else delete next[id];
    savingIds.value = next;
  }

  /** Apply one step to `task` (the currently displayed version). Returns false at a boundary. */
  function step(task: Task, move: KeyboardMove): boolean {
    if (ctx.canMove && !ctx.canMove(task)) {
      ctx.onBlocked?.(task);
      return false;
    }
    const base = overrides.value[task.id] ?? task;
    if (!originals.has(task.id)) originals.set(task.id, { ...task });
    const day = toDateKey(base.start);
    const next: Task = { ...base };

    switch (move) {
      case "earlier":
      case "later": {
        // Elapsed time, so ↑ is always earlier and ↓ always later (also on DST days).
        const start = stepStartElapsed(base.start, move === "earlier" ? -SNAP_MINUTES : SNAP_MINUTES);
        if (start === null) return false;
        next.start = start;
        break;
      }
      case "shorter":
      case "longer": {
        const delta = move === "shorter" ? -SNAP_MINUTES : SNAP_MINUTES;
        const durationMinutes = clamp(Math.round(base.duration * 60) + delta, SNAP_MINUTES, MAX_DURATION_HOURS * 60);
        if (durationMinutes === Math.round(base.duration * 60)) return false;
        next.duration = durationMinutes / 60;
        break;
      }
      case "prevDay":
      case "nextDay":
      case "prevWeek":
      case "nextWeek": {
        next.start = moveToDate(base.start, keyboardTargetDay(day, move));
        break;
      }
    }

    setOverride(task.id, next);
    ctx.onStep?.(next);
    const newDay = toDateKey(next.start);
    const days = ctx.days();
    const first = days[0];
    const last = days[days.length - 1];
    if (first && last && (diffCalendarDays(newDay, first) < 0 || diffCalendarDays(newDay, last) > 0)) {
      ctx.onNavigate?.(newDay);
    }
    scheduleCommit(task.id);
    return true;
  }

  function scheduleCommit(id: string): void {
    window.clearTimeout(timers.get(id));
    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id);
        void commit(id);
      }, KEYBOARD_COMMIT_DELAY_MS)
    );
  }

  async function commit(id: string): Promise<void> {
    const final = overrides.value[id];
    const original = originals.get(id);
    if (!final || !original) return;
    const version = (versions.get(id) ?? 0) + 1;
    versions.set(id, version);

    if (sameSlot(final, original)) {
      originals.delete(id);
      setOverride(id, null);
      return;
    }
    const other = findConflict(final, ctx.tasks());
    if (other) {
      originals.delete(id);
      setOverride(id, null);
      ctx.onConflict(final, other);
      return;
    }

    setSaving(id, true);
    const ok = await ctx.commit(final, original);
    setSaving(id, false);
    // A newer step happened while saving: keep its override; it commits on its own.
    if (versions.get(id) !== version || timers.has(id)) {
      if (ok) originals.set(id, { ...final });
      return;
    }
    originals.delete(id);
    setOverride(id, null);
  }

  /** Commit pending moves right away (e.g. before the task is opened in the editor). */
  function flush(id?: string): void {
    for (const [taskId, timer] of [...timers]) {
      if (id && taskId !== id) continue;
      window.clearTimeout(timer);
      timers.delete(taskId);
      void commit(taskId);
    }
  }

  if (getCurrentScope()) onScopeDispose(() => flush());

  return { overrides, savingIds, step, flush };
}
