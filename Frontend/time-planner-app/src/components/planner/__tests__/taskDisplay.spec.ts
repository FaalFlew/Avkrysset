/**
 * How tasks read on the grid/Today/screen readers: blank (whitespace-only) titles fall back, and
 * tasks that run into a later day say so ("+1d", "Wednesday 08:00 – Thursday 14:00").
 */
import { describe, expect, it } from "vitest";
import {
  displayTitle,
  formatEndDayMarker,
  formatMoveAnnouncement,
  formatSlotAnnouncement,
  formatTaskLabel,
  formatTaskTimeRange,
  taskEndDayOffset,
} from "@/lib/plannerFormat";
import {
  combineDateAndTime,
  endInstant,
  formatTime,
  formatTimeRange,
  formatWeekdayLong,
  toDateKey,
} from "@/lib/datetime";
import { assertZoneApplied, TEST_ZONE } from "@/lib/__tests__/tz";

describe(`zone sanity (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });
});

describe("blank titles", () => {
  it("whitespace-only titles fall back; others are trimmed", () => {
    expect(displayTitle("   ")).toBe("Untitled task");
    expect(displayTitle("\t\n ")).toBe("Untitled task");
    expect(displayTitle("")).toBe("Untitled task");
    expect(displayTitle(null)).toBe("Untitled task");
    expect(displayTitle(undefined, "New task")).toBe("New task");
    expect(displayTitle("  Deep work ")).toBe("Deep work");
  });

  it("labels and announcements never read an empty name", () => {
    const task = { title: "   ", start: combineDateAndTime("2026-10-07", "09:00"), duration: 1 };
    expect(formatTaskLabel(task, "Work").startsWith("Untitled task, ")).toBe(true);
    expect(formatMoveAnnouncement(task)).toMatch(/^Moved task to /);
  });
});

describe("tasks that end on a later day", () => {
  const wed8 = combineDateAndTime("2026-10-07", "08:00");

  it("counts the end day by the last minute the task occupies", () => {
    expect(taskEndDayOffset(wed8, 6)).toBe(0);
    expect(taskEndDayOffset(wed8, 30)).toBe(1); // legacy 30h task: Thursday 14:00
    expect(taskEndDayOffset(wed8, 50)).toBe(2);
    const wed23 = combineDateAndTime("2026-10-07", "23:00");
    expect(taskEndDayOffset(wed23, 1)).toBe(0); // 23:00–00:00 ends "today"
    expect(taskEndDayOffset(wed23, 1.5)).toBe(1); // 23:00–00:30
  });

  it("marks the time range and spells out the end day for screen readers", () => {
    const end = endInstant(wed8, 30);
    expect(formatEndDayMarker(wed8, 30)).toBe("+1d");
    expect(formatEndDayMarker(wed8, 6)).toBe("");
    expect(formatTaskTimeRange(wed8, 30)).toBe(`${formatTimeRange(wed8, 30)} +1d`);
    expect(formatTaskTimeRange(wed8, 6)).toBe(formatTimeRange(wed8, 6));

    const label = formatTaskLabel({ title: "Migration", start: wed8, duration: 30 }, "Work");
    expect(label).toBe(
      `Migration, ${formatWeekdayLong("2026-10-07")} ${formatTime(wed8)} – ${formatWeekdayLong(toDateKey(end))} ${formatTime(end)}, Work`
    );
    expect(formatSlotAnnouncement({ start: wed8, duration: 30 })).toContain(formatWeekdayLong(toDateKey(end)));
    expect(formatMoveAnnouncement({ title: "Migration", start: wed8, duration: 30 })).toContain("+1d");
  });
});
