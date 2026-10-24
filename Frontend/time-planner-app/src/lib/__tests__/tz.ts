/**
 * Test-only helpers: which zone this vitest project runs in (set per project via `env.TZ` in
 * vitest.config.ts) and a guard that it was really applied.
 */
import { expect } from "vitest";

/** Expected UTC offset (minutes east) of each test zone on 2026-01-15. */
const JANUARY_OFFSETS: Record<string, number> = {
  UTC: 0,
  "Europe/Oslo": 60,
  "America/New_York": -300,
  "America/St_Johns": -210,
  "America/Sao_Paulo": -180,
  "America/Santiago": -180,
  "Australia/Sydney": 660,
  "Australia/Lord_Howe": 660,
  "Asia/Kolkata": 330,
  "Asia/Kathmandu": 345,
  "Pacific/Chatham": 825,
  "Pacific/Kiritimati": 840,
  "Pacific/Pago_Pago": -660,
};

/** ICU may report legacy aliases for some zones. */
const ALIASES: Record<string, string[]> = {
  UTC: ["UTC", "Etc/UTC", "Etc/GMT", "GMT"],
  "Asia/Kolkata": ["Asia/Kolkata", "Asia/Calcutta"],
  "Asia/Kathmandu": ["Asia/Kathmandu", "Asia/Katmandu"],
  "Pacific/Pago_Pago": ["Pacific/Pago_Pago", "Pacific/Samoa", "US/Samoa"],
};

/** The zone of the current vitest project. */
export const TEST_ZONE = process.env.TZ ?? "";

export function zoneNames(zone: string): string[] {
  return ALIASES[zone] ?? [zone];
}

/** Fails loudly when the per-project TZ was not applied (tests would silently run in the host zone). */
export function assertZoneApplied(): void {
  expect(TEST_ZONE, "vitest project must set env.TZ").not.toBe("");
  expect(JANUARY_OFFSETS[TEST_ZONE], `no expected offset for ${TEST_ZONE}`).toBeTypeOf("number");
  const offset = 0 - new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset();
  expect(offset, `offset of ${TEST_ZONE} on 2026-01-15`).toBe(JANUARY_OFFSETS[TEST_ZONE]);
  expect(zoneNames(TEST_ZONE)).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
}
