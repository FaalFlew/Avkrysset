/**
 * Planner move/resize math on DST days: moves always go in the requested direction, a press that
 * does not move keeps the exact start (repeated fall-back hour), keyboard steps cross gaps.
 * Runs in every zone of vitest.config.ts; zone-specific cases use describe.runIf.
 */
import { describe, expect, it } from "vitest";
import { effectScope } from "vue";
import {
  shiftStartWallClock,
  stepStartElapsed,
  useKeyboardTaskMoves,
} from "../useTaskDragAndDrop";
import {
  addDays,
  addMinutes,
  combineDateAndTime,
  dayRange,
  diffMinutes,
  minutesSinceStartOfDay,
  splitInstant,
  toDateKey,
  weekDaysOf,
  type DateKey,
  type UtcIsoString,
} from "@/lib/datetime";
import type { Task } from "@/types";
import { TEST_ZONE, assertZoneApplied } from "@/lib/__tests__/tz";

// useKeyboardTaskMoves schedules its commit with window.setTimeout.
(globalThis as { window?: unknown }).window ??= globalThis;

const inZone = (zone: string) => TEST_ZONE === zone;

function task(start: UtcIsoString, duration = 1): Task {
  return { id: "t1", title: "Deep work", start, duration, categoryId: "c", categoryName: "", categoryColor: "" };
}

/** Days of `year` whose length is not 24h in the active zone (DST transitions). */
function transitionDays(year: number): DateKey[] {
  const days: DateKey[] = [];
  for (let key = `${year}-01-01`; key.startsWith(String(year)); key = addDays(key, 1)) {
    const { start, end } = dayRange(key);
    if (diffMinutes(end, start) !== 24 * 60) days.push(key);
  }
  return days;
}

/** Every existing quarter-hour start on `day` (as instants, in order). */
function quarterHourStarts(day: DateKey): UtcIsoString[] {
  const { start, end } = dayRange(day);
  const result: UtcIsoString[] = [];
  for (let t = start; diffMinutes(end, t) > 0; t = addMinutes(t, 15)) result.push(t);
  return result;
}

describe(`zone sanity (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });
});

describe("start-time math on an ordinary day", () => {
  const nine = combineDateAndTime("2026-06-17", "09:00");

  it("keeps the exact start when nothing moved", () => {
    expect(shiftStartWallClock(nine, 0)).toBe(nine);
    expect(shiftStartWallClock(nine, 0, "2026-06-17")).toBe(nine);
  });

  it("moves by wall-clock rows and across days", () => {
    expect(splitInstant(shiftStartWallClock(nine, 45)).time).toBe("09:45");
    expect(splitInstant(shiftStartWallClock(nine, -75)).time).toBe("07:45");
    expect(splitInstant(shiftStartWallClock(nine, 30, "2026-06-19"))).toEqual({ date: "2026-06-19", time: "09:30" });
  });

  it("clamps to 00:00–23:45", () => {
    expect(splitInstant(shiftStartWallClock(nine, -24 * 60)).time).toBe("00:00");
    expect(splitInstant(shiftStartWallClock(nine, 24 * 60)).time).toBe("23:45");
  });

  it("keyboard steps stop at the edges of the day", () => {
    expect(stepStartElapsed(combineDateAndTime("2026-06-17", "00:00"), -15)).toBeNull();
    expect(stepStartElapsed(combineDateAndTime("2026-06-17", "23:45"), 15)).toBeNull();
    expect(splitInstant(stepStartElapsed(nine, 15)!).time).toBe("09:15");
  });
});

describe("DST days: moves never go the wrong way", () => {
  const days = [...transitionDays(2026), ...transitionDays(2018)];

  it.each(days.length ? days : ["2026-06-17"])("%s", (day) => {
    for (const start of quarterHourStarts(day)) {
      // A press without movement keeps the instant (also in the repeated hour).
      expect(shiftStartWallClock(start, 0)).toBe(start);

      for (const delta of [-60, -15, 15, 60]) {
        const moved = shiftStartWallClock(start, delta);
        const direction = Math.sign(diffMinutes(moved, start));
        // Either it moved the requested way, or it could not move at all (edge of the day).
        expect([Math.sign(delta), 0], `${start} ${delta}`).toContain(direction);
        expect(toDateKey(moved)).toBe(day);
      }

      for (const delta of [-15, 15]) {
        const stepped = stepStartElapsed(start, delta);
        if (stepped === null) continue;
        expect(diffMinutes(stepped, start)).toBe(delta);
        expect(toDateKey(stepped)).toBe(day);
        expect(minutesSinceStartOfDay(stepped)).toBeLessThanOrEqual(23 * 60 + 45);
      }
    }
  });
});

describe.runIf(inZone("Europe/Oslo"))("Europe/Oslo regressions", () => {
  it("L1: ↑ on the spring-forward day moves earlier and can pass the gap", () => {
    const start = combineDateAndTime("2026-03-29", "03:00"); // 01:00Z, first hour after the gap
    const scope = effectScope();
    scope.run(() => {
      const moves = useKeyboardTaskMoves({
        days: () => weekDaysOf("2026-03-29"),
        tasks: () => [task(start)],
        commit: async () => true,
        onConflict: () => {},
      });
      const t = task(start);
      expect(moves.step(t, "earlier")).toBe(true);
      expect(moves.overrides.value.t1!.start).toBe("2026-03-29T00:45:00.000Z"); // 01:45 CET
      expect(moves.step(t, "earlier")).toBe(true);
      expect(moves.overrides.value.t1!.start).toBe("2026-03-29T00:30:00.000Z"); // 01:30 CET
      expect(moves.step(t, "later")).toBe(true);
      expect(moves.step(t, "later")).toBe(true);
      expect(moves.overrides.value.t1!.start).toBe(start); // back to 03:00 CEST
    });
    scope.stop();
  });

  it("L1: dragging up one row from 03:00 on the spring-forward day lands before the gap", () => {
    const start = combineDateAndTime("2026-03-29", "03:00");
    expect(shiftStartWallClock(start, -15)).toBe("2026-03-29T00:45:00.000Z");
    expect(shiftStartWallClock(start, -30)).toBe("2026-03-29T00:30:00.000Z");
    expect(diffMinutes(shiftStartWallClock(start, -60), start)).toBeLessThan(0);
  });

  it("L2: a zero-row drag keeps a task in the repeated fall-back hour where it is", () => {
    const second = "2026-10-25T01:30:00.000Z"; // 02:30 CET (second occurrence)
    expect(shiftStartWallClock(second, 0)).toBe(second);
    expect(shiftStartWallClock(second, 0, "2026-10-25")).toBe(second);
  });

  it("L2: ↓ on the second 02:30 moves 15 minutes later", () => {
    const second = "2026-10-25T01:30:00.000Z";
    expect(stepStartElapsed(second, 15)).toBe("2026-10-25T01:45:00.000Z");
    expect(diffMinutes(shiftStartWallClock(second, 15), second)).toBeGreaterThan(0);
  });

  it("L2: keyboard ↓/↑ through the repeated fall-back hour (composable)", () => {
    const second = "2026-10-25T01:30:00.000Z"; // 02:30 CET (second occurrence)
    const scope = effectScope();
    scope.run(() => {
      const moves = useKeyboardTaskMoves({
        days: () => weekDaysOf("2026-10-25"),
        tasks: () => [task(second)],
        commit: async () => true,
        onConflict: () => {},
      });
      const t = task(second);
      expect(moves.step(t, "later")).toBe(true);
      expect(moves.overrides.value.t1!.start).toBe("2026-10-25T01:45:00.000Z");
      expect(moves.step(t, "earlier")).toBe(true);
      expect(moves.step(t, "earlier")).toBe(true);
      expect(moves.overrides.value.t1!.start).toBe("2026-10-25T01:15:00.000Z"); // still the second 02:15
    });
    scope.stop();
  });
});
