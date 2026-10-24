/**
 * Side-by-side lanes for overlapping blocks (org tasks may overlap personal ones, Q3): pure
 * interval-graph lane assignment, chains, span expansion, drawn min heights and DST days.
 */
import { describe, expect, it } from "vitest";
import { blockExtent, layoutLanes, laneStyle, type LaneInput, type LanePlacement } from "../laneLayout";
import { MIN_BLOCK_HEIGHT } from "../gridConstants";
import { combineDateAndTime } from "@/lib/datetime";
import { TEST_ZONE, assertZoneApplied } from "@/lib/__tests__/tz";

const inZone = (zone: string) => TEST_ZONE === zone;

/** Interval in minutes == px (1px per minute). */
const iv = (id: string, top: number, bottom: number): LaneInput => ({ id, top, bottom });
const lanesOf = (items: LaneInput[]) => Object.fromEntries(layoutLanes(items));
const at = (lane: number, lanes: number, span = 1): LanePlacement => ({ lane, lanes, span });

/** Lane items for tasks given as [id, start instant, hours] (as WeekView builds them). */
function tasksToLanes(tasks: [string, string, number][]) {
  return lanesOf(
    tasks.map(([id, start, hours]) => {
      const box = blockExtent(start, hours);
      return iv(id, box.top, box.top + box.height);
    })
  );
}

describe(`zone sanity (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });
});

describe("layoutLanes", () => {
  it("non-overlapping blocks stay full width", () => {
    expect(lanesOf([iv("a", 0, 60), iv("b", 120, 180)])).toEqual({ a: at(0, 1), b: at(0, 1) });
    expect(lanesOf([])).toEqual({});
  });

  it("touching blocks (half-open) don't share a cluster", () => {
    expect(lanesOf([iv("a", 60, 120), iv("b", 120, 180)])).toEqual({ a: at(0, 1), b: at(0, 1) });
  });

  it("an overlapping pair splits the column; the longer (earlier) block takes the left lane", () => {
    expect(lanesOf([iv("short", 60, 90), iv("long", 60, 180)])).toEqual({ long: at(0, 2), short: at(1, 2) });
    expect(lanesOf([iv("late", 90, 150), iv("early", 60, 120)])).toEqual({ early: at(0, 2), late: at(1, 2) });
  });

  it("three-way overlap → three lanes", () => {
    expect(lanesOf([iv("a", 0, 120), iv("b", 30, 120), iv("c", 60, 120)])).toEqual({
      a: at(0, 3),
      b: at(1, 3),
      c: at(2, 3),
    });
  });

  it("a chain A–B–C (A and C don't overlap) is one 2-lane cluster; C reuses A's lane", () => {
    // A 9–10, B 9:30–11, C 10–11:30 (C overlaps B, not A).
    expect(lanesOf([iv("a", 540, 600), iv("b", 570, 660), iv("c", 600, 690)])).toEqual({
      a: at(0, 2),
      b: at(1, 2),
      c: at(0, 2),
    });
  });

  it("blocks expand right over lanes that are free for their whole extent", () => {
    // A long block, B/C stacked in lane 1, D overlaps B only → lane 2; C spans lanes 1–2.
    const result = lanesOf([iv("a", 0, 300), iv("b", 0, 60), iv("d", 30, 90), iv("c", 120, 180)]);
    expect(result).toEqual({ a: at(0, 3), b: at(1, 3), d: at(2, 3), c: at(1, 3, 2) });
  });

  it("separate clusters get their own lane counts", () => {
    const result = lanesOf([iv("a", 0, 60), iv("b", 30, 90), iv("c", 300, 360)]);
    expect(result.c).toEqual(at(0, 1));
    expect(result.a!.lanes).toBe(2);
  });

  it("is independent of input order and deterministic for identical intervals", () => {
    const items = [iv("x", 60, 120), iv("y", 60, 120), iv("z", 90, 200)];
    const forward = lanesOf(items);
    const backward = lanesOf([...items].reverse());
    expect(backward).toEqual(forward);
    expect(forward).toEqual({ x: at(0, 3), y: at(1, 3), z: at(2, 3) });
  });

});

describe("blockExtent + lanes", () => {
  it("min-height blocks collide visually → separate lanes", () => {
    // 5-minute task at 09:00 is drawn MIN_BLOCK_HEIGHT tall, so a task at 09:05 would be hidden.
    const result = tasksToLanes([
      ["tiny", combineDateAndTime("2026-06-10", "09:00"), 5 / 60],
      ["next", combineDateAndTime("2026-06-10", "09:05"), 1],
    ]);
    expect(blockExtent(combineDateAndTime("2026-06-10", "09:00"), 5 / 60).height).toBe(MIN_BLOCK_HEIGHT);
    expect(result.tiny!.lanes).toBe(2);
    expect(result.next!.lanes).toBe(2);
  });

  it("back-to-back tasks share the column (drawn with the 2px gap)", () => {
    const result = tasksToLanes([
      ["a", combineDateAndTime("2026-06-10", "09:00"), 1],
      ["b", combineDateAndTime("2026-06-10", "10:00"), 1],
    ]);
    expect(result).toEqual({ a: at(0, 1), b: at(0, 1) });
  });

  it("a block running past midnight is clamped at the day's end", () => {
    const box = blockExtent(combineDateAndTime("2026-06-10", "23:00"), 3);
    expect(box.top).toBe(23 * 60);
    expect(box.height).toBe(60 - 2);
    expect(box.clamped).toBe(true);
  });
});

describe.runIf(inZone("Europe/Oslo"))("Europe/Oslo: DST days", () => {
  it("fall-back day: the two different 02:30s are drawn at the same row → separate lanes", () => {
    // 2026-10-25: 03:00 CEST → 02:00 CET. 00:30Z is 02:30 CEST, 01:30Z is 02:30 CET.
    const first = "2026-10-25T00:30:00Z";
    const second = "2026-10-25T01:30:00Z";
    expect(blockExtent(first, 0.5).top).toBe(blockExtent(second, 0.5).top);
    const result = tasksToLanes([
      ["cest", first, 0.5],
      ["cet", second, 0.5],
    ]);
    expect(result).toEqual({ cest: at(0, 2), cet: at(1, 2) });
  });

  it("spring-forward day: a task ending at the gap and one starting after it share the column", () => {
    // 2026-03-29: 02:00 CET → 03:00 CEST. 01:00 CET + 1h = 03:00 CEST.
    const result = tasksToLanes([
      ["before", "2026-03-29T00:00:00Z", 1],
      ["after", "2026-03-29T01:00:00Z", 1],
    ]);
    expect(blockExtent("2026-03-29T00:00:00Z", 1)).toEqual({ top: 60, height: 120 - 2, clamped: false });
    expect(result).toEqual({ before: at(0, 1), after: at(0, 1) });
  });

  it("spring-forward day: drawn overlap across the gap opens a second lane", () => {
    const result = tasksToLanes([
      ["long", "2026-03-29T00:30:00Z", 1], // 01:30 CET → 03:30 CEST, drawn 01:30–03:30
      ["after", "2026-03-29T01:00:00Z", 1], // 03:00 CEST
    ]);
    expect(result).toEqual({ long: at(0, 2), after: at(1, 2) });
  });
});

describe.runIf(inZone("America/New_York"))("America/New_York: fall-back day", () => {
  it("the repeated 01:30 lands in two lanes", () => {
    // 2026-11-01: 02:00 EDT → 01:00 EST. 05:30Z is 01:30 EDT, 06:30Z is 01:30 EST.
    const result = tasksToLanes([
      ["edt", "2026-11-01T05:30:00Z", 0.5],
      ["est", "2026-11-01T06:30:00Z", 0.5],
    ]);
    expect(result).toEqual({ edt: at(0, 2), est: at(1, 2) });
  });
});

describe("laneStyle", () => {
  it("full width for single-lane blocks", () => {
    expect(laneStyle(undefined)).toEqual({});
    expect(laneStyle(at(0, 1))).toEqual({});
  });

  it("left/width from lane, lanes and span", () => {
    expect(laneStyle(at(1, 3, 2))).toEqual({
      left: "calc(2px + (100% - 8px) * 1 / 3)",
      width: "calc((100% - 8px) * 2 / 3 - 2px)",
      right: "auto",
    });
  });
});
