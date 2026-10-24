/** Phone day-swipe recognizer: axis lock, thresholds, velocity, edge exclusion, arbitration. */
import { describe, expect, it } from "vitest";
import {
  SWIPE,
  abortSwipe,
  endSwipe,
  moveSwipe,
  outcomeSide,
  startSwipe,
  swipeOffset,
  type SwipeSample,
  type SwipeState,
} from "../daySwipe";

const VIEWPORT = 375;
const WIDTH = 320; // day column width

function begin(x = 200, y = 400, enabled = true): SwipeState {
  return startSwipe({ pointerId: 1, x, y, t: 0, viewportWidth: VIEWPORT, enabled });
}

function feed(state: SwipeState, samples: SwipeSample[]): SwipeState {
  return samples.reduce((s, sample) => moveSwipe(s, sample), state);
}

/** A straight horizontal move from x0 by `dx` over `ms`, sampled every 16ms. */
function path(x0: number, y0: number, dx: number, dy: number, ms: number): SwipeSample[] {
  const steps = Math.max(1, Math.round(ms / 16));
  return Array.from({ length: steps }, (_, i) => {
    const f = (i + 1) / steps;
    return { x: x0 + dx * f, y: y0 + dy * f, t: Math.round(ms * f) };
  });
}

describe("start", () => {
  it("ignores touches within 24px of the screen edges (system back gestures) and when disabled", () => {
    expect(begin(10).phase).toBe("cancelled");
    expect(begin(VIEWPORT - 10).phase).toBe("cancelled");
    expect(begin(SWIPE.edgeExclusion).phase).toBe("pending");
    expect(begin(200, 400, false).phase).toBe("cancelled");
  });
});

describe("axis lock", () => {
  it("stays pending below 10px", () => {
    const s = feed(begin(), [{ x: 206, y: 405, t: 30 }]);
    expect(s.phase).toBe("pending");
    expect(s.moved).toBe(false);
  });

  it("locks horizontal when |dx| > |dy| × 1.2", () => {
    expect(feed(begin(), [{ x: 188, y: 405, t: 30 }]).phase).toBe("swiping");
  });

  it("hands vertical (and steep diagonal) movement to native scrolling", () => {
    expect(feed(begin(), [{ x: 202, y: 415, t: 30 }]).phase).toBe("vertical");
    expect(feed(begin(), [{ x: 210, y: 409, t: 30 }]).phase).toBe("vertical"); // 10 vs 9×1.2
    // Once vertical, later horizontal movement does not turn it into a swipe.
    const s = feed(begin(), [{ x: 202, y: 415, t: 30 }, { x: 100, y: 415, t: 60 }]);
    expect(s.phase).toBe("vertical");
  });
});

describe("release", () => {
  it("commits beyond 25% of the width: left → next day, right → previous day", () => {
    const left = feed(begin(), path(200, 400, -100, 3, 600)); // slow, 100px > 80px
    expect(endSwipe(left, { t: 620, width: WIDTH })).toEqual({ outcome: "next", suppressClick: true });
    const right = feed(begin(100), path(100, 400, 100, -3, 600));
    expect(endSwipe(right, { t: 620, width: WIDTH }).outcome).toBe("prev");
  });

  it("commits a quick flick (> 0.4 px/ms over > 30px) even when short", () => {
    const flick = feed(begin(), path(200, 400, -50, 0, 80)); // 0.625 px/ms
    expect(endSwipe(flick, { t: 85, width: WIDTH }).outcome).toBe("next");
  });

  it("springs back when slow and short, or when the finger stopped before lifting", () => {
    const slow = feed(begin(), path(200, 400, -60, 0, 600)); // 0.1 px/ms, 60px < 80px
    expect(endSwipe(slow, { t: 610, width: WIDTH }).outcome).toBe("none");
    const quickButHeld = feed(begin(), path(200, 400, -50, 0, 80));
    expect(endSwipe(quickButHeld, { t: 80 + SWIPE.staleVelocityMs + 50, width: WIDTH }).outcome).toBe("none");
    const tooShort = feed(begin(), path(200, 400, -25, 0, 20)); // fast but < 30px
    expect(endSwipe(tooShort, { t: 22, width: WIDTH }).outcome).toBe("none");
  });

  it("a flick against the drag direction does not commit", () => {
    const back = feed(begin(), [...path(200, 400, -70, 0, 400), { x: 160, y: 400, t: 416 }]);
    expect(back.dx).toBeLessThan(0);
    expect(back.velocity).toBeGreaterThan(0);
    expect(endSwipe(back, { t: 420, width: WIDTH }).outcome).toBe("none");
  });
});

describe("arbitration and click suppression", () => {
  it("a tap (no movement) neither swipes nor suppresses the click", () => {
    expect(endSwipe(begin(), { t: 100, width: WIDTH })).toEqual({ outcome: "none", suppressClick: false });
  });

  it("any movement beyond the lock distance suppresses the click, even when vertical", () => {
    const vertical = feed(begin(), [{ x: 200, y: 430, t: 40 }]);
    expect(endSwipe(vertical, { t: 60, width: WIDTH })).toEqual({ outcome: "none", suppressClick: true });
  });

  it("an aborted swipe (second finger, pointercancel, task drag took over) does nothing", () => {
    const swiping = feed(begin(), path(200, 400, -150, 0, 200));
    const aborted = abortSwipe(swiping);
    expect(aborted.phase).toBe("cancelled");
    expect(endSwipe(aborted, { t: 210, width: WIDTH }).outcome).toBe("none");
    expect(moveSwipe(aborted, { x: 0, y: 400, t: 220 })).toBe(aborted);
  });
});

describe("follow-the-finger offset", () => {
  it("follows 1:1, then resists past 60% of the width", () => {
    expect(swipeOffset(-100, WIDTH)).toBe(-100);
    expect(swipeOffset(192, WIDTH)).toBe(192);
    expect(swipeOffset(292, WIDTH)).toBeCloseTo(192 + 100 * SWIPE.resistance);
    expect(swipeOffset(-292, WIDTH)).toBeCloseTo(-(192 + 100 * SWIPE.resistance));
  });

  it("maps outcomes to day steps", () => {
    expect(outcomeSide("next")).toBe(1);
    expect(outcomeSide("prev")).toBe(-1);
    expect(outcomeSide("none")).toBe(0);
  });
});
