/**
 * Range-aware zone label (print header + guest CSV), in the server's format:
 * "Europe/Oslo (UTC+02:00)", "Europe/Oslo (UTC+01:00/+02:00)" when DST changes within the range,
 * "UTC" for UTC. Runs in every test zone.
 */
import { describe, expect, it } from "vitest";
import {
  formatZoneLabelForRange,
  getActiveTimeZone,
  getUtcOffsetMinutes,
  isoWeeksRange,
  monthsRange,
  toEpochMs,
  utcOffsetsWithin,
} from "../datetime";
import { TEST_ZONE, assertZoneApplied } from "./tz";

const YEAR_2026 = monthsRange(2026, 0, 11);
const JANUARY = monthsRange(2026, 0, 0);
const JULY = monthsRange(2026, 6, 6);

/** Expected labels per zone: [full year 2026, January 2026, July 2026]. */
const EXPECTED: Record<string, [string, string, string]> = {
  UTC: ["UTC", "UTC", "UTC"],
  "Europe/Oslo": ["(UTC+01:00/+02:00)", "(UTC+01:00)", "(UTC+02:00)"],
  "America/New_York": ["(UTC-05:00/-04:00)", "(UTC-05:00)", "(UTC-04:00)"],
  "America/St_Johns": ["(UTC-03:30/-02:30)", "(UTC-03:30)", "(UTC-02:30)"],
  "America/Sao_Paulo": ["(UTC-03:00)", "(UTC-03:00)", "(UTC-03:00)"],
  "America/Santiago": ["(UTC-04:00/-03:00)", "(UTC-03:00)", "(UTC-04:00)"],
  "Australia/Sydney": ["(UTC+10:00/+11:00)", "(UTC+11:00)", "(UTC+10:00)"],
  "Australia/Lord_Howe": ["(UTC+10:30/+11:00)", "(UTC+11:00)", "(UTC+10:30)"],
  "Asia/Kolkata": ["(UTC+05:30)", "(UTC+05:30)", "(UTC+05:30)"],
  "Asia/Kathmandu": ["(UTC+05:45)", "(UTC+05:45)", "(UTC+05:45)"],
  "Pacific/Chatham": ["(UTC+12:45/+13:45)", "(UTC+13:45)", "(UTC+12:45)"],
  "Pacific/Kiritimati": ["(UTC+14:00)", "(UTC+14:00)", "(UTC+14:00)"],
  "Pacific/Pago_Pago": ["(UTC-11:00)", "(UTC-11:00)", "(UTC-11:00)"],
};

function label(suffix: string): string {
  const zone = getActiveTimeZone();
  if (suffix !== "UTC") return `${zone} ${suffix}`;
  // ICU may name the UTC project's zone "Etc/GMT"; only UTC / Etc/UTC collapse to "UTC".
  return zone === "UTC" || zone === "Etc/UTC" ? "UTC" : `${zone} (UTC+00:00)`;
}

describe(`formatZoneLabelForRange (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });

  it("lists every offset in force during the range, ascending", () => {
    const [year, january, july] = EXPECTED[TEST_ZONE]!;
    expect(formatZoneLabelForRange(YEAR_2026)).toBe(label(year));
    expect(formatZoneLabelForRange(JANUARY)).toBe(label(january));
    expect(formatZoneLabelForRange(JULY)).toBe(label(july));
  });

  it("catches a DST change inside a single week and at the very end of the range", () => {
    // Europe/Oslo switches on 2026-03-29 (Sunday of ISO week 13).
    const week13 = isoWeeksRange(2026, 13, 13);
    const offsets = utcOffsetsWithin(week13);
    expect(offsets).toContain(getUtcOffsetMinutes(week13.start));
    expect(offsets).toContain(getUtcOffsetMinutes(toEpochMs(week13.end) - 1));
    if (TEST_ZONE === "Europe/Oslo") expect(formatZoneLabelForRange(week13)).toBe(`${getActiveTimeZone()} (UTC+01:00/+02:00)`);
    if (TEST_ZONE === "Europe/Oslo") {
      expect(formatZoneLabelForRange(isoWeeksRange(2026, 12, 12))).toBe(`${getActiveTimeZone()} (UTC+01:00)`);
    }
  });

  it("handles an empty range (start = end)", () => {
    const at = YEAR_2026.start;
    expect(utcOffsetsWithin({ start: at, end: at })).toEqual([getUtcOffsetMinutes(at)]);
  });
});
