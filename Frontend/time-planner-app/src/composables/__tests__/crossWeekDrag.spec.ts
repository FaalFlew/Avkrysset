/**
 * Moving tasks between weeks: edge auto-advance timing, cancel-outside rule, the day a drop or a
 * keyboard day/week step lands on, and wall-clock preservation across a DST change between weeks
 * (Europe/Oslo and America/New_York via describe.runIf; generic checks run in every zone).
 */
import { describe, expect, it } from "vitest";
import { effectScope } from "vue";
import {
  advanceDwell,
  edgeZoneAt,
  initialDwell,
  isOutsideRect,
  keyboardTargetDay,
  shiftStartWallClock,
  useKeyboardTaskMoves,
  type DwellState,
  type EdgeSide,
} from "../useTaskDragAndDrop";
import { addDays, combineDateAndTime, splitInstant, toDateKey, weekDaysOf, type DateKey } from "@/lib/datetime";
import type { Task } from "@/types";
import { TEST_ZONE, assertZoneApplied } from "@/lib/__tests__/tz";

// useKeyboardTaskMoves schedules its commit with window.setTimeout.
(globalThis as { window?: unknown }).window ??= globalThis;

const inZone = (zone: string) => TEST_ZONE === zone;

function task(start: string, duration = 1): Task {
  return { id: "t1", title: "Deep work", start, duration, categoryId: "c", categoryName: "", categoryColor: "" };
}

describe(`zone sanity (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });
});

describe("edge zones", () => {
  const bounds = { left: 100, right: 1100 };

  it("detects the left/right 48px zones and anything beyond them", () => {
    expect(edgeZoneAt(600, bounds)).toBe(0);
    expect(edgeZoneAt(148, bounds)).toBe(-1);
    expect(edgeZoneAt(149, bounds)).toBe(0);
    expect(edgeZoneAt(20, bounds)).toBe(-1); // over the gutter / sidebar
    expect(edgeZoneAt(1052, bounds)).toBe(1);
    expect(edgeZoneAt(1051, bounds)).toBe(0);
    expect(edgeZoneAt(1300, bounds)).toBe(1);
  });

  it("on a very narrow grid only counts the space beyond the edges", () => {
    const narrow = { left: 0, right: 90 };
    expect(edgeZoneAt(10, narrow)).toBe(0);
    expect(edgeZoneAt(-1, narrow)).toBe(-1);
    expect(edgeZoneAt(91, narrow)).toBe(1);
  });

  it("releasing outside the grid rectangle cancels", () => {
    const rect = { left: 100, right: 1100, top: 50, bottom: 850 };
    expect(isOutsideRect(500, 400, rect)).toBe(false);
    expect(isOutsideRect(99, 400, rect)).toBe(true);
    expect(isOutsideRect(500, 851, rect)).toBe(true);
    expect(isOutsideRect(1100, 850, rect)).toBe(false);
  });
});

describe("edge dwell timing", () => {
  /** Feed (time, zone) samples; return the times at which an advance fired. */
  function run(samples: [number, EdgeSide][], start: DwellState = initialDwell()): number[] {
    let state = start;
    const fired: number[] = [];
    for (const [now, zone] of samples) {
      const result = advanceDwell(state, zone, now, 600, 900);
      state = result.state;
      if (result.fire) fired.push(now);
    }
    return fired;
  }

  it("fires after 600ms at an edge, then every 900ms while it stays there", () => {
    const samples: [number, EdgeSide][] = [];
    for (let t = 0; t <= 2500; t += 50) samples.push([t, 1]);
    expect(run(samples)).toEqual([600, 1500, 2400]);
  });

  it("leaving the zone resets the timer", () => {
    expect(run([[0, -1], [500, -1], [550, 0], [600, -1], [1100, -1], [1200, -1]])).toEqual([1200]);
  });

  it("switching edges restarts the timer", () => {
    expect(run([[0, 1], [500, -1], [1000, -1], [1100, -1]])).toEqual([1100]);
  });

  it("an edge the drag started in is ignored until the pointer leaves it", () => {
    // Grabbed a Monday task near the left edge: holding still must not flip the week.
    expect(run([[0, -1], [700, -1], [2000, -1]], initialDwell(-1))).toEqual([]);
    // After leaving once, the same edge works normally.
    expect(run([[0, -1], [100, 0], [200, -1], [800, -1]], initialDwell(-1))).toEqual([800]);
    // The other edge is never disarmed.
    expect(run([[0, 1], [600, 1]], initialDwell(-1))).toEqual([600]);
  });
});

describe("target days across week boundaries", () => {
  it("day steps cross Sunday→Monday and Monday→Sunday; week steps keep the weekday", () => {
    expect(keyboardTargetDay("2026-10-11", "nextDay")).toBe("2026-10-12"); // Sun → next Mon
    expect(keyboardTargetDay("2026-10-05", "prevDay")).toBe("2026-10-04"); // Mon → previous Sun
    expect(keyboardTargetDay("2026-10-07", "nextWeek")).toBe("2026-10-14");
    expect(keyboardTargetDay("2026-12-30", "nextWeek")).toBe("2027-01-06"); // across the year
    expect(keyboardTargetDay("2026-01-02", "prevWeek")).toBe("2025-12-26");
  });

  it("a drop on a day of another week keeps the wall-clock time (any zone)", () => {
    const start = combineDateAndTime("2026-10-07", "09:00");
    for (const target of ["2026-10-14", "2026-10-30", "2026-11-04", "2026-03-30", "2027-01-06"] as DateKey[]) {
      const moved = shiftStartWallClock(start, 0, target);
      expect(splitInstant(moved)).toEqual({ date: target, time: "09:00" });
      const later = shiftStartWallClock(start, 90, target);
      expect(splitInstant(later)).toEqual({ date: target, time: "10:30" });
    }
  });
});

describe("keyboard moves across weeks (composable)", () => {
  function setup(start: string, visibleWeekOf: DateKey) {
    const navigated: DateKey[] = [];
    const scope = effectScope();
    const moves = scope.run(() =>
      useKeyboardTaskMoves({
        days: () => weekDaysOf(visibleWeekOf),
        tasks: () => [task(start)],
        commit: async () => true,
        onConflict: () => {},
        onNavigate: (day) => navigated.push(day),
      })
    )!;
    return { moves, navigated, scope };
  }

  it("→ on Sunday moves to next Monday and shows that week; ← comes back", () => {
    const start = combineDateAndTime("2026-10-11", "14:00"); // Sunday
    const { moves, navigated, scope } = setup(start, "2026-10-11");
    const t = task(start);
    expect(moves.step(t, "nextDay")).toBe(true);
    expect(splitInstant(moves.overrides.value.t1!.start)).toEqual({ date: "2026-10-12", time: "14:00" });
    expect(navigated).toEqual(["2026-10-12"]);
    scope.stop();
  });

  it("← on Monday moves to the previous Sunday", () => {
    const start = combineDateAndTime("2026-10-05", "08:15"); // Monday
    const { moves, navigated, scope } = setup(start, "2026-10-05");
    expect(moves.step(task(start), "prevDay")).toBe(true);
    expect(splitInstant(moves.overrides.value.t1!.start)).toEqual({ date: "2026-10-04", time: "08:15" });
    expect(navigated).toEqual(["2026-10-04"]);
    scope.stop();
  });

  it("PageDown/PageUp move a week and keep the time; inside the week no navigation", () => {
    const start = combineDateAndTime("2026-10-07", "09:00"); // Wednesday
    const { moves, navigated, scope } = setup(start, "2026-10-07");
    const t = task(start);
    expect(moves.step(t, "nextWeek")).toBe(true);
    expect(splitInstant(moves.overrides.value.t1!.start)).toEqual({ date: "2026-10-14", time: "09:00" });
    expect(navigated).toEqual(["2026-10-14"]);
    expect(moves.step(t, "prevWeek")).toBe(true);
    expect(moves.overrides.value.t1!.start).toBe(start);
    // (The test's visible week never changes, so moving back into it needs no navigation.)
    expect(navigated).toEqual(["2026-10-14"]);
    scope.stop();
  });

  it("a day step that stays inside the visible week does not navigate", () => {
    const start = combineDateAndTime("2026-10-07", "09:00");
    const { moves, navigated, scope } = setup(start, "2026-10-07");
    expect(moves.step(task(start), "nextDay")).toBe(true);
    expect(navigated).toEqual([]);
    scope.stop();
  });
});

describe.runIf(inZone("Europe/Oslo"))("Europe/Oslo: DST change between weeks", () => {
  // Clocks go back on Sunday 2026-10-25: 09:00 is 07:00Z before, 08:00Z after.
  it("dragging 09:00 from the week of Oct 19 into the week of Oct 26 keeps 09:00", () => {
    const start = combineDateAndTime("2026-10-19", "09:00");
    expect(start).toBe("2026-10-19T07:00:00.000Z");
    expect(shiftStartWallClock(start, 0, "2026-10-26")).toBe("2026-10-26T08:00:00.000Z");
    expect(shiftStartWallClock(start, 0, addDays("2026-10-26", 3))).toBe("2026-10-29T08:00:00.000Z");
  });

  it("PageDown across the change keeps 09:00 (one week = 169 elapsed hours here)", () => {
    const start = combineDateAndTime("2026-10-21", "09:00");
    const scope = effectScope();
    scope.run(() => {
      const moves = useKeyboardTaskMoves({
        days: () => weekDaysOf("2026-10-21"),
        tasks: () => [task(start)],
        commit: async () => true,
        onConflict: () => {},
      });
      moves.step(task(start), "nextWeek");
      expect(moves.overrides.value.t1!.start).toBe("2026-10-28T08:00:00.000Z");
      expect(toDateKey(moves.overrides.value.t1!.start)).toBe("2026-10-28");
    });
    scope.stop();
  });
});

describe.runIf(inZone("America/New_York"))("America/New_York: DST change between weeks", () => {
  // Clocks go back on Sunday 2026-11-01: 09:00 is 13:00Z before, 14:00Z after.
  it("dragging 09:00 from the week of Oct 26 into the week of Nov 2 keeps 09:00", () => {
    const start = combineDateAndTime("2026-10-26", "09:00");
    expect(start).toBe("2026-10-26T13:00:00.000Z");
    expect(shiftStartWallClock(start, 0, "2026-11-02")).toBe("2026-11-02T14:00:00.000Z");
  });

  it("→ from Sunday Nov 1 (the change day) to Monday keeps the time", () => {
    const start = combineDateAndTime("2026-11-01", "18:30");
    const scope = effectScope();
    scope.run(() => {
      const moves = useKeyboardTaskMoves({
        days: () => weekDaysOf("2026-11-01"),
        tasks: () => [task(start)],
        commit: async () => true,
        onConflict: () => {},
      });
      moves.step(task(start), "nextDay");
      expect(splitInstant(moves.overrides.value.t1!.start)).toEqual({ date: "2026-11-02", time: "18:30" });
    });
    scope.stop();
  });

  it("spring forward: week of Mar 2 → week of Mar 9, 2026 keeps 09:00", () => {
    const start = combineDateAndTime("2026-03-04", "09:00"); // EST, 14:00Z
    expect(start).toBe("2026-03-04T14:00:00.000Z");
    expect(shiftStartWallClock(start, 0, "2026-03-11")).toBe("2026-03-11T13:00:00.000Z"); // EDT
  });
});
