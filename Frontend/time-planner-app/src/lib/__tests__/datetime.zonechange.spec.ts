/**
 * Device time-zone changes while the app is running (travel, OS setting): native Date follows
 * immediately, so every helper output (labels, the X-Time-Zone value, the zone label) must too.
 * Node re-reads process.env.TZ for Date and the Intl default zone, like Chrome does on an OS
 * zone change. Each spec file runs in its own process, and the zone is restored afterwards.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatTime,
  formatTimeOfDay,
  formatTimeZoneLabel,
  formatUtcOffset,
  getActiveTimeZone,
  gridBox,
  minutesSinceStartOfDay,
  onTimeZoneChange,
  refreshActiveTimeZone,
  splitInstant,
} from "../datetime";
import { TEST_ZONE, assertZoneApplied, zoneNames } from "./tz";

const x = "2026-10-05T07:00:00.000Z";
/** A zone with different offsets from the project's zone. */
const TARGET = zoneNames(TEST_ZONE).includes("America/New_York") ? "Asia/Kolkata" : "America/New_York";
/** Wall-clock time of `x` in TARGET. */
const TARGET_TIME = TARGET === "America/New_York" ? "03:00" : "12:30";

function restoreZone(): void {
  process.env.TZ = TEST_ZONE;
  refreshActiveTimeZone();
}

afterEach(() => {
  vi.useRealTimers();
  restoreZone();
});

describe(`device zone change (${TEST_ZONE} → ${TARGET})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
    expect(zoneNames(TEST_ZONE)).toContain(getActiveTimeZone());
  });

  it("labels, grid position and the X-Time-Zone value agree right after the change", () => {
    const before = getActiveTimeZone();
    expect(formatTime(x)).toBe(formatTimeOfDay(splitInstant(x).time));
    const seen: [string, string][] = [];
    const unsubscribe = onTimeZoneChange((zone, previous) => seen.push([zone, previous]));

    process.env.TZ = TARGET; // what an OS zone change does to a running tab
    try {
      // Native-Date math (grid, editor fields) follows the new zone...
      expect(splitInstant(x).time).toBe(TARGET_TIME);
      expect(gridBox(x, 1).top).toBe(minutesSinceStartOfDay(x));
      // ...and so do the Intl-based outputs, without any explicit refresh.
      expect(formatTime(x)).toBe(formatTimeOfDay(TARGET_TIME));
      expect(zoneNames(TARGET)).toContain(getActiveTimeZone());
      expect(formatTimeZoneLabel(x)).toBe(`${formatUtcOffset(x)} · ${getActiveTimeZone()}`);
      expect(formatUtcOffset(x)).toBe(TARGET === "America/New_York" ? "UTC-04:00" : "UTC+05:30");
      expect(seen).toEqual([[getActiveTimeZone(), before]]);
    } finally {
      unsubscribe();
      restoreZone();
    }
    expect(zoneNames(TEST_ZONE)).toContain(getActiveTimeZone());
    expect(formatTime(x)).toBe(formatTimeOfDay(splitInstant(x).time));
  });

  it("refreshActiveTimeZone reports whether the zone changed", () => {
    expect(refreshActiveTimeZone()).toBe(false);
    process.env.TZ = TARGET;
    expect(refreshActiveTimeZone()).toBe(true);
    expect(zoneNames(TARGET)).toContain(getActiveTimeZone());
    expect(refreshActiveTimeZone()).toBe(false);
  });
});

describe.runIf(TEST_ZONE === "Europe/Oslo")("same-offset zone change (Oslo → Paris)", () => {
  it("is detected by refreshActiveTimeZone at once", () => {
    getActiveTimeZone();
    process.env.TZ = "Europe/Paris";
    expect(refreshActiveTimeZone()).toBe(true);
    expect(getActiveTimeZone()).toBe("Europe/Paris");
  });

  it("is picked up by getActiveTimeZone within the re-check interval", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    getActiveTimeZone();
    process.env.TZ = "Europe/Paris";
    // Identical offsets: the cheap probe cannot tell, the throttled Intl lookup can.
    vi.setSystemTime(Date.now() + 1500);
    expect(getActiveTimeZone()).toBe("Europe/Paris");
  });
});
