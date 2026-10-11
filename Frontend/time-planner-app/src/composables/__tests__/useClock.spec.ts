import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick } from "vue";
import { useTimeZone, useToday } from "../useClock";
import { formatTime, getActiveTimeZone, refreshActiveTimeZone } from "@/lib/datetime";
import { TEST_ZONE, zoneNames } from "@/lib/__tests__/tz";

const TARGET = zoneNames(TEST_ZONE).includes("America/New_York") ? "Asia/Kolkata" : "America/New_York";

afterEach(() => {
  vi.useRealTimers();
  process.env.TZ = TEST_ZONE;
  refreshActiveTimeZone();
});

describe(`useTimeZone (${TEST_ZONE})`, () => {
  it("is a singleton holding the active zone", () => {
    const a = useTimeZone();
    const b = useTimeZone();
    expect(a).toBe(b);
    expect(a.timeZone.value).toBe(getActiveTimeZone());
  });

  it("updates when refreshActiveTimeZone detects a change", async () => {
    const { timeZone } = useTimeZone();
    process.env.TZ = TARGET;
    expect(refreshActiveTimeZone()).toBe(true);
    await Promise.resolve();
    expect(timeZone.value).toBe(getActiveTimeZone());
    expect(zoneNames(TARGET)).toContain(timeZone.value);
  });

  it("updates (after a microtask) when any helper call notices the change", async () => {
    const { timeZone } = useTimeZone();
    const before = timeZone.value;
    process.env.TZ = TARGET;
    formatTime("2026-10-05T07:00:00.000Z"); // e.g. a label rendered by some component
    expect(timeZone.value).toBe(before); // never mutated synchronously (could be mid-render)
    await Promise.resolve();
    expect(zoneNames(TARGET)).toContain(timeZone.value);
  });
});

describe(`useToday (${TEST_ZONE})`, () => {
  it("re-evaluates today's date when the device zone changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 23:30 UTC: already tomorrow east of UTC, still today in New York.
    vi.setSystemTime(Date.UTC(2026, 9, 5, 23, 30));
    const scope = effectScope();
    const today = scope.run(() => useToday())!;
    const expected = (zone: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
        Date.UTC(2026, 9, 5, 23, 30)
      );
    expect(today.value).toBe(expected(getActiveTimeZone()));

    process.env.TZ = "America/New_York";
    refreshActiveTimeZone();
    await Promise.resolve();
    await nextTick();
    expect(today.value).toBe("2026-10-05");
    scope.stop();
  });
});
