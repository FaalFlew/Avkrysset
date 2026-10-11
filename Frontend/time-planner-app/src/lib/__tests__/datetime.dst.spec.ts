import { describe, expect, it } from "vitest";
import {
  addDays,
  addMinutes,
  atMinutesOfDay,
  combineDateAndTime,
  dayRange,
  diffMinutes,
  gridBox,
  isInRange,
  minutesSinceStartOfDay,
  monthsRange,
  normalizeStoredInstant,
  overlaps,
  parseApiInstant,
  resolveWallClock,
  splitInstant,
  startOfDayInstant,
  timeOfDayFromMinutes,
  toApiInstant,
  toDateKey,
  weekRange,
  type DateKey,
} from "../datetime";
import { TEST_ZONE, assertZoneApplied } from "./tz";

const inZone = (zone: string) => TEST_ZONE === zone;

function daysOf(year: number): DateKey[] {
  const days: DateKey[] = [];
  for (let key = `${year}-01-01`; key.startsWith(String(year)); key = addDays(key, 1)) {
    days.push(key);
  }
  return days;
}

const DAYS_2026 = daysOf(2026);

function dayLengthHours(key: DateKey): number {
  const { start, end } = dayRange(key);
  return diffMinutes(end, start) / 60;
}

describe(`zone sanity (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });
});

describe("fixed DST cases", () => {
  describe.runIf(inZone("Europe/Oslo"))("Europe/Oslo", () => {
    it("spring forward: 23h day, 02:30 does not exist", () => {
      expect(startOfDayInstant("2026-03-29")).toBe("2026-03-28T23:00:00.000Z");
      expect(dayLengthHours("2026-03-29")).toBe(23);
      expect(resolveWallClock("2026-03-29", "02:30")).toEqual({
        instant: "2026-03-29T01:30:00.000Z",
        status: "gap",
      });
      expect(splitInstant("2026-03-29T01:30:00.000Z").time).toBe("03:30");
    });

    it("fall back: 25h day, 02:30 happens twice (earlier wins)", () => {
      expect(dayLengthHours("2026-10-25")).toBe(25);
      expect(resolveWallClock("2026-10-25", "02:30")).toEqual({
        instant: "2026-10-25T00:30:00.000Z",
        status: "ambiguous",
      });
      expect(splitInstant("2026-10-25T01:30:00.000Z")).toEqual({
        date: "2026-10-25",
        time: "02:30",
      });
    });

    it("week and year ranges", () => {
      expect(weekRange("2026-10-21")).toEqual({
        start: "2026-10-18T22:00:00.000Z",
        end: "2026-10-25T23:00:00.000Z",
      });
      expect(monthsRange(2026, 0, 11)).toEqual({
        start: "2025-12-31T23:00:00.000Z",
        end: "2026-12-31T23:00:00.000Z",
      });
    });

    it("the worked example: 09:00 Oslo survives a round trip through the legacy API format", () => {
      const created = combineDateAndTime("2026-10-03", "09:00");
      expect(created).toBe("2026-10-03T07:00:00.000Z");
      // The old backend echoed the value without 'Z'; it must still read as 09:00 local.
      expect(splitInstant(parseApiInstant("2026-10-03T07:00:00")).time).toBe("09:00");
    });

    it("legacy guest strings are local wall-clock time", () => {
      expect(normalizeStoredInstant("2025-08-01 09:00:00")).toBe("2025-08-01T07:00:00.000Z");
    });

    it("grid placement follows wall-clock rows on DST days", () => {
      // 01:30 -> 03:30 local on the 23h day is 1h of elapsed time but spans two hour rows.
      expect(gridBox("2026-03-29T00:30:00.000Z", 1)).toEqual({
        top: 90,
        height: 120,
        endsNextDay: false,
      });
      // A task starting in the first 02:30 and ending in the repeated hour.
      expect(gridBox("2026-10-25T00:30:00.000Z", 1)).toEqual({
        top: 150,
        height: 60,
        endsNextDay: false,
      });
    });

    it("dragging across the gap lands on the wall-clock slot", () => {
      const start = combineDateAndTime("2026-03-29", "01:30");
      const moved = atMinutesOfDay("2026-03-29", minutesSinceStartOfDay(start) + 60);
      expect(moved).toBe("2026-03-29T01:30:00.000Z"); // 02:30 does not exist -> 03:30
    });
  });

  describe.runIf(inZone("America/New_York"))("America/New_York", () => {
    it("gap and overlap", () => {
      expect(resolveWallClock("2026-03-08", "02:30")).toEqual({
        instant: "2026-03-08T07:30:00.000Z",
        status: "gap",
      });
      expect(resolveWallClock("2026-11-01", "01:30")).toEqual({
        instant: "2026-11-01T05:30:00.000Z",
        status: "ambiguous",
      });
      expect(dayLengthHours("2026-03-08")).toBe(23);
      expect(dayLengthHours("2026-11-01")).toBe(25);
    });
  });

  describe.runIf(inZone("America/St_Johns"))("America/St_Johns", () => {
    it("half-hour offset with DST", () => {
      expect(combineDateAndTime("2026-01-15", "09:00")).toBe("2026-01-15T12:30:00.000Z");
      expect(resolveWallClock("2026-03-08", "02:30")).toEqual({
        instant: "2026-03-08T06:00:00.000Z",
        status: "gap",
      });
      expect(combineDateAndTime("2026-07-15", "09:00")).toBe("2026-07-15T11:30:00.000Z");
    });
  });

  describe.runIf(inZone("America/Sao_Paulo"))("America/Sao_Paulo", () => {
    it("historic midnight gap: the day starts at 01:00", () => {
      expect(startOfDayInstant("2018-11-04")).toBe("2018-11-04T03:00:00.000Z");
      expect(splitInstant(startOfDayInstant("2018-11-04")).time).toBe("01:00");
      expect(toDateKey(startOfDayInstant("2018-11-04"))).toBe("2018-11-04");
      expect(dayLengthHours("2018-11-04")).toBe(23);
    });
  });

  describe.runIf(inZone("America/Santiago"))("America/Santiago", () => {
    it("DST changes at midnight", () => {
      // Clocks go back from Sunday 00:00 to Saturday 23:00 -> Saturday has 25 hours.
      expect(dayLengthHours("2026-04-04")).toBe(25);
      expect(startOfDayInstant("2026-04-05")).toBe("2026-04-05T04:00:00.000Z");
      // Clocks jump from Sunday 00:00 to 01:00 -> the day starts at 01:00.
      expect(splitInstant(startOfDayInstant("2026-09-06")).time).toBe("01:00");
      expect(dayLengthHours("2026-09-06")).toBe(23);
    });
  });

  describe.runIf(inZone("Australia/Sydney"))("Australia/Sydney", () => {
    it("southern-hemisphere gap and overlap", () => {
      expect(resolveWallClock("2026-10-04", "02:30")).toEqual({
        instant: "2026-10-03T16:30:00.000Z",
        status: "gap",
      });
      expect(resolveWallClock("2026-04-05", "02:30")).toEqual({
        instant: "2026-04-04T15:30:00.000Z",
        status: "ambiguous",
      });
    });
  });

  describe.runIf(inZone("Australia/Lord_Howe"))("Australia/Lord_Howe", () => {
    it("30-minute DST shift", () => {
      expect(resolveWallClock("2026-10-04", "02:15")).toEqual({
        instant: "2026-10-03T15:45:00.000Z",
        status: "gap",
      });
      expect(dayLengthHours("2026-10-04")).toBe(23.5);
      expect(dayLengthHours("2026-04-05")).toBe(24.5);
    });
  });

  describe.runIf(inZone("Asia/Kolkata"))("Asia/Kolkata", () => {
    it("+05:30", () => {
      expect(combineDateAndTime("2026-10-03", "09:00")).toBe("2026-10-03T03:30:00.000Z");
    });
  });

  describe.runIf(inZone("Asia/Kathmandu"))("Asia/Kathmandu", () => {
    it("+05:45", () => {
      expect(combineDateAndTime("2026-10-03", "09:00")).toBe("2026-10-03T03:15:00.000Z");
    });
  });

  describe.runIf(inZone("Pacific/Chatham"))("Pacific/Chatham", () => {
    it("+13:45 keeps the local date", () => {
      const instant = combineDateAndTime("2026-10-03", "09:00");
      expect(instant).toBe("2026-10-02T19:15:00.000Z");
      expect(toDateKey(instant)).toBe("2026-10-03");
    });
  });

  describe.runIf(inZone("Pacific/Kiritimati"))("Pacific/Kiritimati", () => {
    it("+14: the local day starts on the previous UTC day", () => {
      expect(dayRange("2026-10-03")).toEqual({
        start: "2026-10-02T10:00:00.000Z",
        end: "2026-10-03T10:00:00.000Z",
      });
      expect(toDateKey(combineDateAndTime("2026-10-03", "09:00"))).toBe("2026-10-03");
    });
  });

  describe.runIf(inZone("Pacific/Pago_Pago"))("Pacific/Pago_Pago", () => {
    it("-11: the local evening is the next UTC day", () => {
      const instant = combineDateAndTime("2026-10-03", "20:00");
      expect(instant).toBe("2026-10-04T07:00:00.000Z");
      expect(toDateKey(instant)).toBe("2026-10-03");
    });
  });

  describe.runIf(inZone("UTC"))("UTC", () => {
    it("every day of 2026 is 24h", () => {
      expect(DAYS_2026.every((k) => dayLengthHours(k) === 24)).toBe(true);
    });
  });
});

describe(`properties for every day of 2026 (${TEST_ZONE})`, () => {
  it("each day starts on its own date and is 23, 23.5, 24, 24.5 or 25 hours long", () => {
    for (const key of DAYS_2026) {
      expect(toDateKey(startOfDayInstant(key))).toBe(key);
      expect([23, 23.5, 24, 24.5, 25]).toContain(dayLengthHours(key));
    }
  });

  it("days and weeks tile the timeline without gaps or overlaps", () => {
    for (const key of DAYS_2026) {
      expect(dayRange(key).end).toBe(dayRange(addDays(key, 1)).start);
      expect(weekRange(key).end).toBe(weekRange(addDays(key, 7)).start);
      expect(isInRange(weekRange(key).start, weekRange(key))).toBe(true);
      expect(isInRange(weekRange(key).end, weekRange(key))).toBe(false);
    }
  });

  it("wall-clock times round-trip; gaps move forward; overlaps pick the earlier instant", () => {
    for (const key of DAYS_2026) {
      for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
        const time = timeOfDayFromMinutes(minutes);
        const { instant, status } = resolveWallClock(key, time);
        const split = splitInstant(instant);
        if (status === "gap") {
          expect(split.date >= key).toBe(true);
          expect(split.date > key || split.time > time).toBe(true);
        } else {
          expect(split).toEqual({ date: key, time });
          if (status === "ambiguous") {
            // The other occurrence is later and shows the same wall-clock time.
            const later = splitInstant(addMinutes(instant, 60));
            const later30 = splitInstant(addMinutes(instant, 30));
            expect([later.time, later30.time]).toContain(time);
          }
        }
      }
    }
  });

  it("atMinutesOfDay inverts minutesSinceStartOfDay for non-ambiguous instants", () => {
    for (const key of DAYS_2026) {
      const { start, end } = dayRange(key);
      for (let i = start; parseApiInstant(i) < parseApiInstant(end); i = addMinutes(i, 15)) {
        const back = atMinutesOfDay(toDateKey(i), minutesSinceStartOfDay(i));
        const status = resolveWallClock(toDateKey(i), splitInstant(i).time).status;
        if (status === "exact") expect(back).toBe(i);
        else expect(splitInstant(back)).toEqual(splitInstant(i));
      }
    }
  });

  it("API strings without an offset are UTC and serialization is canonical", () => {
    for (const key of DAYS_2026) {
      const x = toApiInstant(parseApiInstant(`${key}T13:45:00.000Z`));
      expect(x).toBe(`${key}T13:45:00.000Z`);
      expect(parseApiInstant(x.slice(0, -1))).toBe(parseApiInstant(x));
      expect(toApiInstant(parseApiInstant(x))).toBe(x);
    }
  });

  it("touching tasks never overlap", () => {
    for (const key of DAYS_2026) {
      const start = startOfDayInstant(key);
      for (let m = 0; m < 24 * 60; m += 15) {
        const a = addMinutes(start, m);
        expect(overlaps(a, 0.25, addMinutes(a, 15), 0.25)).toBe(false);
        expect(overlaps(a, 0.5, addMinutes(a, 15), 0.25)).toBe(true);
      }
    }
  });
});
