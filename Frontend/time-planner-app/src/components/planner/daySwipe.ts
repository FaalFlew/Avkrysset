// src/components/planner/daySwipe.ts — decision logic of the phone day-swipe (single-day planner).
// Pure (no DOM): WeekView feeds it pointer samples and acts on the results.
//
// One owner per touch sequence:
// - The swipe starts "pending" on a touch pointerdown in the grid (not within 24px of the screen
//   edges, which belong to the browser/system back gestures; not while disabled).
// - After 10px it locks: horizontal when |dx| > |dy| × 1.2 → "swiping" (we own it; the grid's
//   `touch-action: pan-y` means the browser does not pan horizontally), otherwise "vertical"
//   (native scrolling owns it; we stop tracking).
// - A second finger, pointercancel (the browser took over) or a task drag becoming active →
//   "cancelled".
// - On release a swipe commits when it travelled > 25% of the grid width, or was flung faster
//   than 0.4 px/ms over > 30px. Swipe left → next day, right → previous day.
// - Any sequence that moved beyond the lock distance suppresses the click/tap on release.

export const SWIPE = {
  /** Movement (px) before the axis is decided. */
  lockDistance: 10,
  /** Horizontal wins when |dx| > |dy| × axisRatio. */
  axisRatio: 1.2,
  /** Commit when |dx| exceeds this fraction of the grid width... */
  commitFraction: 0.25,
  /** ...or when flung faster than this (px/ms) over at least flingMinDistance px. */
  flingVelocity: 0.4,
  flingMinDistance: 30,
  /** Ignore swipes that start this close (px) to the viewport's left/right edge. */
  edgeExclusion: 24,
  /** Velocity older than this (ms) at release counts as 0 (the finger stopped). */
  staleVelocityMs: 100,
  /** Rubber band: full follow up to this fraction of the width, then `resistance` × the rest. */
  resistanceStart: 0.6,
  resistance: 0.3,
} as const;

export type SwipePhase = "pending" | "swiping" | "vertical" | "cancelled";
export type SwipeOutcome = "next" | "prev" | "none";

export interface SwipeState {
  phase: SwipePhase;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastT: number;
  /** Horizontal travel since the start (px; negative = towards the left). */
  dx: number;
  /** Smoothed horizontal velocity (px/ms, signed). */
  velocity: number;
  /** Moved beyond the lock distance at some point: a click/tap must not fire on release. */
  moved: boolean;
}

export interface SwipeSample {
  x: number;
  y: number;
  /** Timestamp in ms (event.timeStamp / performance.now()). */
  t: number;
}

/** Begin tracking a touch. Starts "cancelled" when disabled or too close to a screen edge. */
export function startSwipe(
  input: SwipeSample & { pointerId: number; viewportWidth: number; enabled: boolean }
): SwipeState {
  const nearEdge = input.x < SWIPE.edgeExclusion || input.x > input.viewportWidth - SWIPE.edgeExclusion;
  return {
    phase: !input.enabled || nearEdge ? "cancelled" : "pending",
    pointerId: input.pointerId,
    startX: input.x,
    startY: input.y,
    lastX: input.x,
    lastT: input.t,
    dx: 0,
    velocity: 0,
    moved: false,
  };
}

/** Feed a move sample. */
export function moveSwipe(state: SwipeState, sample: SwipeSample): SwipeState {
  if (state.phase === "cancelled" || state.phase === "vertical") return state;
  const dx = sample.x - state.startX;
  const dy = sample.y - state.startY;
  const distance = Math.hypot(dx, dy);
  const moved = state.moved || distance >= SWIPE.lockDistance;

  if (state.phase === "pending") {
    if (distance < SWIPE.lockDistance) return { ...state, lastX: sample.x, lastT: sample.t, moved };
    const horizontal = Math.abs(dx) > Math.abs(dy) * SWIPE.axisRatio;
    if (!horizontal) return { ...state, phase: "vertical", moved };
    const dt = Math.max(1, sample.t - state.lastT);
    return { ...state, phase: "swiping", dx, velocity: (sample.x - state.lastX) / dt, lastX: sample.x, lastT: sample.t, moved };
  }

  // swiping
  const dt = Math.max(1, sample.t - state.lastT);
  const instant = (sample.x - state.lastX) / dt;
  return {
    ...state,
    dx,
    velocity: 0.6 * instant + 0.4 * state.velocity,
    lastX: sample.x,
    lastT: sample.t,
    moved,
  };
}

/** Second finger, pointercancel, or a task drag took over. */
export function abortSwipe(state: SwipeState): SwipeState {
  return { ...state, phase: "cancelled" };
}

/** Release: what to do, and whether the click/tap that follows must be swallowed. */
export function endSwipe(
  state: SwipeState,
  release: { t: number; width: number }
): { outcome: SwipeOutcome; suppressClick: boolean } {
  const suppressClick = state.moved || state.phase === "swiping";
  if (state.phase !== "swiping") return { outcome: "none", suppressClick };

  const velocity = release.t - state.lastT > SWIPE.staleVelocityMs ? 0 : state.velocity;
  const far = Math.abs(state.dx) > release.width * SWIPE.commitFraction;
  const flung =
    Math.abs(velocity) > SWIPE.flingVelocity &&
    Math.abs(state.dx) > SWIPE.flingMinDistance &&
    Math.sign(velocity) === Math.sign(state.dx);
  if (!far && !flung) return { outcome: "none", suppressClick };
  return { outcome: state.dx < 0 ? "next" : "prev", suppressClick };
}

/** How far the day content follows the finger: 1:1, then a rubber band near the edge. */
export function swipeOffset(dx: number, width: number): number {
  const limit = width * SWIPE.resistanceStart;
  const abs = Math.abs(dx);
  if (abs <= limit) return dx;
  return Math.sign(dx) * (limit + (abs - limit) * SWIPE.resistance);
}

/** -1 / +1 day for an outcome (0 for none). */
export function outcomeSide(outcome: SwipeOutcome): -1 | 0 | 1 {
  return outcome === "next" ? 1 : outcome === "prev" ? -1 : 0;
}
