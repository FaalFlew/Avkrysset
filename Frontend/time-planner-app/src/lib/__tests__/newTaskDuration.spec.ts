/**
 * The default length of a new task (backlog item 2): min(1h, free time before the next task),
 * floored to 15 minutes, at least 15 — with a note when less than 15 minutes are free. Durations
 * are elapsed time, so a DST change between the start and the next task is counted correctly.
 */
import { describe, expect, it } from "vitest";
import { atMinutesOfDay } from "../datetime";
import { freeTimeNote, suggestNewTaskDuration } from "../newTaskDuration";
import { TEST_ZONE, assertZoneApplied } from "./tz";

const DAY = "2026-10-05"; // a Monday without a DST change in any test zone
const at = (hh: number, mm: number, day = DAY) => atMinutesOfDay(day, hh * 60 + mm);
const task = (start: string, title = "Standup") => ({ start, title });

describe(`zone sanity (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });
});

describe("suggestNewTaskDuration", () => {
  it("is 1 hour when no task follows", () => {
    const before = task(at(8, 0)); // earlier tasks don't limit it
    expect(suggestNewTaskDuration(at(9, 0), [before])).toMatchObject({ minutes: 60, freeMinutes: null });
    expect(freeTimeNote(suggestNewTaskDuration(at(9, 0), []))).toBe("");
  });

  it("fits a 30-minute gap exactly", () => {
    expect(suggestNewTaskDuration(at(9, 0), [task(at(9, 30))]).minutes).toBe(30);
  });

  it("rounds a 50-minute gap down to 45 and uses the NEXT task, not the first in the list", () => {
    const tasks = [task(at(13, 0), "Later"), task(at(9, 50), "Next")];
    expect(suggestNewTaskDuration(at(9, 0), tasks)).toMatchObject({ minutes: 45, nextTitle: "Next" });
  });

  it("keeps 15 minutes when only 10 are free, and the editor says so", () => {
    const suggestion = suggestNewTaskDuration(at(9, 0), [task(at(9, 10), "Standup")]);
    expect(suggestion.minutes).toBe(15);
    expect(freeTimeNote(suggestion)).toBe("Only 10 min free before “Standup”.");
  });

  it("counts a task on the next day (23:30 → 00:15 leaves 45 minutes)", () => {
    expect(suggestNewTaskDuration(at(23, 30), [task(at(0, 15, "2026-10-06"))]).minutes).toBe(45);
  });
});

describe.runIf(TEST_ZONE === "Europe/Oslo")("DST days in Europe/Oslo (elapsed time, not wall clock)", () => {
  it("spring forward: 01:30 → 03:00 is only 30 minutes", () => {
    // 2026-03-29: 02:00 jumps to 03:00. 01:30 = 00:30Z, 03:00 = 01:00Z.
    expect(suggestNewTaskDuration("2026-03-29T00:30:00.000Z", [task("2026-03-29T01:00:00.000Z")]).minutes).toBe(30);
  });

  it("fall back: 02:30 (first) → 02:45 (second occurrence) is 75 minutes, so 1 hour", () => {
    // 2026-10-25: 03:00 goes back to 02:00. First 02:30 = 00:30Z, second 02:45 = 01:45Z.
    expect(suggestNewTaskDuration("2026-10-25T00:30:00.000Z", [task("2026-10-25T01:45:00.000Z")]).minutes).toBe(60);
  });
});
