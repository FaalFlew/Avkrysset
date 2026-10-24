/**
 * Labels and comparisons of an EXPLICIT zone (an organization's), which must not depend on the
 * device zone the test project runs in: DST on both sides, 45-minute and 30-minute-DST offsets,
 * alias names ICU may report, and zones that switch at different hours of the same day.
 */
import { describe, expect, it } from "vitest";
import {
  formatTimeInZone,
  formatZoneLabel,
  getActiveTimeZone,
  isoWeeksRange,
  monthsRange,
  uses12HourClock,
  zoneDiffersFromActive,
} from "../datetime";
import { TEST_ZONE, assertZoneApplied, zoneNames } from "./tz";

const YEAR_2026 = monthsRange(2026, 0, 11);
const JANUARY = monthsRange(2026, 0, 0);
const JULY = monthsRange(2026, 6, 6);
const range = (start: string, end: string) => ({ start, end });

describe(`formatZoneLabel (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });

  it("labels any zone with its own offset at that instant, whatever the device zone", () => {
    expect(formatZoneLabel("America/New_York", "2026-07-01T12:00:00.000Z")).toBe("America/New_York (UTC-04:00)");
    expect(formatZoneLabel("America/New_York", "2026-01-15T12:00:00.000Z")).toBe("America/New_York (UTC-05:00)");
    // DST ends 2026-11-01 at 02:00 EDT = 06:00Z.
    expect(formatZoneLabel("America/New_York", "2026-11-01T05:59:00.000Z")).toBe("America/New_York (UTC-04:00)");
    expect(formatZoneLabel("America/New_York", "2026-11-01T06:00:00.000Z")).toBe("America/New_York (UTC-05:00)");
    expect(formatZoneLabel("Asia/Kathmandu", "2026-07-01T12:00:00.000Z")).toBe("Asia/Kathmandu (UTC+05:45)");
    expect(formatZoneLabel("America/St_Johns", "2026-01-15T12:00:00.000Z")).toBe("America/St_Johns (UTC-03:30)");
    expect(formatZoneLabel("Australia/Lord_Howe", "2026-07-01T12:00:00.000Z")).toBe("Australia/Lord_Howe (UTC+10:30)");
    expect(formatZoneLabel("Australia/Lord_Howe", "2026-01-15T12:00:00.000Z")).toBe("Australia/Lord_Howe (UTC+11:00)");
    expect(formatZoneLabel("Pacific/Chatham", "2026-01-15T12:00:00.000Z")).toBe("Pacific/Chatham (UTC+13:45)");
    expect(formatZoneLabel("Pacific/Kiritimati", "2026-01-15T12:00:00.000Z")).toBe("Pacific/Kiritimati (UTC+14:00)");
    expect(formatZoneLabel("UTC", "2026-07-01T12:00:00.000Z")).toBe("UTC");
  });

  it("keeps alias names and returns unknown zones unchanged", () => {
    expect(formatZoneLabel("Asia/Calcutta", "2026-07-01T12:00:00.000Z")).toBe("Asia/Calcutta (UTC+05:30)");
    expect(formatZoneLabel("Mars/Olympus_Mons", "2026-07-01T12:00:00.000Z")).toBe("Mars/Olympus_Mons");
  });
});

describe(`formatTimeInZone (${TEST_ZONE})`, () => {
  it("shows the wall clock of the given zone in the locale's clock style", () => {
    const text = formatTimeInZone("2026-07-01T07:00:00.000Z", "America/New_York").replace(/\s/g, " ");
    expect(text).toBe(uses12HourClock() ? "3:00 AM" : "03:00");
    const kathmandu = formatTimeInZone("2026-07-01T07:00:00.000Z", "Asia/Kathmandu").replace(/\s/g, " ");
    expect(kathmandu).toBe(uses12HourClock() ? "12:45 PM" : "12:45");
  });
});

describe(`zoneDiffersFromActive (${TEST_ZONE})`, () => {
  it("never reports the device zone, or an alias ICU may use for it, as different", () => {
    for (const name of [getActiveTimeZone(), ...zoneNames(TEST_ZONE)]) {
      expect(zoneDiffersFromActive(name, YEAR_2026), name).toBe(false);
    }
  });

  it("reports a zone whose offset differs at some point of the range", () => {
    // +14:00 all year: no test zone other than Kiritimati matches it.
    expect(zoneDiffersFromActive("Pacific/Kiritimati", JANUARY)).toBe(TEST_ZONE !== "Pacific/Kiritimati");
    // -11:00 all year.
    expect(zoneDiffersFromActive("Pacific/Pago_Pago", JULY)).toBe(TEST_ZONE !== "Pacific/Pago_Pago");
    // An unknown zone has nothing to compare.
    expect(zoneDiffersFromActive("Mars/Olympus_Mons", JULY)).toBe(false);
  });

  it("compares offsets during the range only (a zone without DST matches in one season)", () => {
    if (TEST_ZONE !== "Europe/Oslo") return;
    // Africa/Lagos is UTC+01:00 all year: equal to Oslo in winter, different in summer.
    expect(zoneDiffersFromActive("Africa/Lagos", JANUARY)).toBe(false);
    expect(zoneDiffersFromActive("Africa/Lagos", JULY)).toBe(true);
    // ISO 2026-W13 contains Oslo's switch to summer time (Sunday 2026-03-29, 01:00Z).
    expect(zoneDiffersFromActive("Africa/Lagos", isoWeeksRange(2026, 13, 13))).toBe(true);
    expect(zoneDiffersFromActive("Africa/Lagos", isoWeeksRange(2026, 12, 12))).toBe(false);
  });

  it("catches zones that switch at different hours of the same day", () => {
    if (TEST_ZONE !== "America/New_York") return;
    // Cuba and New York both go from UTC-05:00 to UTC-04:00 on 2026-03-08, Havana at 00:00 local
    // (05:00Z), New York at 02:00 local (07:00Z): they differ for those two hours only.
    const preconditions = [
      formatZoneLabel("America/Havana", "2026-03-08T04:00:00.000Z") === "America/Havana (UTC-05:00)",
      formatZoneLabel("America/Havana", "2026-03-08T06:00:00.000Z") === "America/Havana (UTC-04:00)",
    ];
    if (!preconditions.every(Boolean)) return; // this ICU build has other rules for Cuba
    expect(zoneDiffersFromActive("America/Havana", range("2026-03-07T20:00:00.000Z", "2026-03-08T20:00:00.000Z"))).toBe(true);
    expect(zoneDiffersFromActive("America/Havana", range("2026-03-08T08:00:00.000Z", "2026-03-09T08:00:00.000Z"))).toBe(false);
  });
});
