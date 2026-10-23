import { describe, expect, it } from "vitest";
import dayjs from "dayjs";
import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  atMinutesOfDay,
  combineDateAndTime,
  compareInstants,
  dateKeyFromParts,
  dateKeyParts,
  dayRange,
  daysInMonth,
  diffCalendarDays,
  diffMinutes,
  endAtTimeOfDay,
  endInstant,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDayOfMonth,
  formatDuration,
  formatDurationMinutes,
  formatHourLabel,
  formatMonthSpan,
  formatRelativeToNow,
  formatTime,
  formatTimeOfDay,
  formatTimeRange,
  formatTimeZoneLabel,
  formatUtcOffset,
  formatWeekdayDay,
  formatWeekdayShort,
  getActiveTimeZone,
  getUtcOffsetMinutes,
  gridBox,
  isDateKey,
  isInRange,
  isTimeOfDay,
  isToday,
  isValidApiInstant,
  isoWeekKey,
  isoWeekOf,
  isoWeekStartKey,
  isoWeekday,
  isoWeeksInYear,
  minutesFromTimeOfDay,
  minutesSince,
  minutesSinceStartOfDay,
  minutesUntil,
  monthGrid,
  monthKey,
  monthKeyOf,
  monthNames,
  monthsRange,
  moveToDate,
  msUntilNextLocalMidnight,
  normalizeApiInstant,
  normalizeStoredInstant,
  nowInstant,
  overlaps,
  parseApiInstant,
  parseStoredInstant,
  splitInstant,
  startOfDayInstant,
  timeOfDayFromMinutes,
  toApiInstant,
  toDateKey,
  toEpochMs,
  todayKey,
  toZoned,
  tryParseApiInstant,
  weekDaysOf,
  weekdayNames,
  weekRange,
  yearRange,
} from "../datetime";
import { TEST_ZONE, assertZoneApplied, zoneNames } from "./tz";

describe(`zone sanity (${TEST_ZONE})`, () => {
  it("runs in the zone configured for this project", () => {
    assertZoneApplied();
  });

  it("resolves the active zone lazily from Intl", () => {
    expect(zoneNames(TEST_ZONE)).toContain(getActiveTimeZone());
    expect(getUtcOffsetMinutes(Date.UTC(2026, 0, 15))).toBe(
      0 - new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset()
    );
  });
});

describe("parseApiInstant / toApiInstant", () => {
  const canonical = "2026-10-03T07:00:00.000Z";
  const ms = Date.UTC(2026, 9, 3, 7);

  it.each([
    canonical,
    "2026-10-03T07:00:00Z",
    "2026-10-03T07:00Z",
    "2026-10-03t07:00:00z",
    "2026-10-03 07:00:00Z",
    "2026-10-03T07:00:00", // legacy backend: no offset = UTC
    "2026-10-03T07:00:00.0000000", // .NET 7-digit fraction
    "2026-10-03T09:00:00+02:00",
    "2026-10-03T09:00:00+0200",
    "2026-10-03T01:30:00-05:30",
    "  2026-10-03T07:00:00.000Z  ",
  ])("parses %s as the same instant", (value) => {
    expect(parseApiInstant(value)).toBe(ms);
    expect(normalizeApiInstant(value)).toBe(canonical);
  });

  it("keeps milliseconds and truncates extra fraction digits", () => {
    expect(normalizeApiInstant("2026-10-03T07:00:00.1239999Z")).toBe("2026-10-03T07:00:00.123Z");
    expect(normalizeApiInstant("2026-10-03T07:00:00.5")).toBe("2026-10-03T07:00:00.500Z");
  });

  it("handles years below 100 literally (DateTime.MinValue)", () => {
    expect(normalizeApiInstant("0001-01-01T00:00:00")).toBe("0001-01-01T00:00:00.000Z");
    expect(toApiInstant(parseApiInstant("0099-12-31T23:59:59.999Z"))).toBe(
      "0099-12-31T23:59:59.999Z"
    );
  });

  it.each([
    "",
    "garbage",
    "2026-10-03",
    "2026-13-01T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "2026-10-03T24:00:00Z",
    "2026-10-03T23:60:00Z",
    "2026-10-03T07:00:00+19:00",
    "2026-10-03T07:00:00 Z",
  ])("rejects %j", (value) => {
    expect(() => parseApiInstant(value)).toThrow(RangeError);
    expect(tryParseApiInstant(value)).toBeNull();
    expect(isValidApiInstant(value)).toBe(false);
  });

  it("rejects non-strings without throwing in the try-variants", () => {
    expect(tryParseApiInstant(undefined)).toBeNull();
    expect(tryParseApiInstant(123)).toBeNull();
    expect(isValidApiInstant(null)).toBe(false);
  });

  it("accepts every InstantInput form", () => {
    expect(toEpochMs(ms)).toBe(ms);
    expect(toEpochMs(new Date(ms))).toBe(ms);
    expect(toEpochMs(dayjs(ms))).toBe(ms);
    expect(toEpochMs(canonical)).toBe(ms);
    expect(() => toEpochMs(Number.NaN)).toThrow(RangeError);
  });

  it("compares instants for sorting", () => {
    const sorted = ["2026-10-03T09:00:00.000Z", "2026-10-03T07:00:00.000Z"].sort(compareInstants);
    expect(sorted[0]).toBe(canonical);
  });

  it("produces exactly the backend's serialization", () => {
    expect(nowInstant()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("parseStoredInstant / normalizeStoredInstant (guest data)", () => {
  it("reads legacy offset-less values as local wall-clock time", () => {
    const value = normalizeStoredInstant("2025-08-01 09:00:00");
    expect(value).toBe(combineDateAndTime("2025-08-01", "09:00"));
    expect(splitInstant(value!)).toEqual({ date: "2025-08-01", time: "09:00" });
  });

  it("passes canonical UTC values through unchanged", () => {
    expect(normalizeStoredInstant("2026-10-03T07:00:00.000Z")).toBe("2026-10-03T07:00:00.000Z");
    expect(normalizeStoredInstant("2026-10-03T07:00:00Z")).toBe("2026-10-03T07:00:00.000Z");
  });

  it("treats a bare date as the start of that local day", () => {
    expect(normalizeStoredInstant("2026-10-03")).toBe(startOfDayInstant("2026-10-03"));
  });

  it("returns null for garbage", () => {
    expect(normalizeStoredInstant("not a date")).toBeNull();
    expect(normalizeStoredInstant(undefined)).toBeNull();
    expect(normalizeStoredInstant(42)).toBeNull();
    expect(() => parseStoredInstant("nope")).toThrow(RangeError);
  });

  it("keeps seconds of legacy values", () => {
    const value = normalizeStoredInstant("2025-08-01 09:00:30")!;
    expect(diffMinutes(value, combineDateAndTime("2025-08-01", "09:00"))).toBe(0.5);
  });
});

describe("calendar dates", () => {
  it("validates and splits keys", () => {
    expect(isDateKey("2024-02-29")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-1-01")).toBe(false);
    expect(isDateKey(20260101)).toBe(false);
    expect(dateKeyParts("2026-10-03")).toEqual({ year: 2026, monthIndex: 9, day: 3 });
    expect(() => dateKeyParts("2026-10-32")).toThrow(RangeError);
    expect(dateKeyFromParts(2026, 12, 1)).toBe("2027-01-01");
    expect(dateKeyFromParts(2026, 0, 0)).toBe("2025-12-31");
  });

  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-03-29", 7)).toBe("2026-04-05");
    expect(diffCalendarDays("2026-10-05", "2026-10-03")).toBe(2);
    expect(diffCalendarDays("2026-03-28", "2026-03-30")).toBe(-2);
  });

  it("adds months, clamping the day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(daysInMonth(2026, 1)).toBe(28);
  });

  it("computes ISO weekdays and week days (Monday first)", () => {
    expect(isoWeekday("2026-10-05")).toBe(1);
    expect(isoWeekday("2026-10-04")).toBe(7);
    expect(weekDaysOf("2026-10-03")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("builds month grids with ISO week numbers", () => {
    const grid = monthGrid(2026, 1); // February 2026 starts on a Sunday
    expect(grid[0].days[0]).toBe("2026-01-26");
    expect(grid[0].week).toEqual({ isoYear: 2026, week: 5 });
    expect(grid[grid.length - 1].days[6]).toBe("2026-03-01");
    expect(grid).toHaveLength(5);
  });

  it("returns keys unchanged from toDateKey", () => {
    expect(toDateKey("2026-10-03")).toBe("2026-10-03");
  });

  it("builds bucket keys", () => {
    expect(monthKey(2026, 0)).toBe("2026-01");
    expect(monthKey(2026, 12)).toBe("2027-01");
    expect(monthKeyOf("2026-10-03")).toBe("2026-10");
    expect(isoWeekKey({ isoYear: 2026, week: 5 })).toBe("2026-W05");
  });
});

describe("ISO weeks", () => {
  it.each([
    [2020, 53],
    [2021, 52],
    [2026, 53],
    [2027, 52],
    [2032, 53],
  ])("isoWeeksInYear(%i) = %i", (year, weeks) => {
    expect(isoWeeksInYear(year)).toBe(weeks);
  });

  it.each([
    [2026, 1, "2025-12-29"],
    [2026, 53, "2026-12-28"],
    [2027, 1, "2027-01-04"],
    [2027, 10, "2027-03-08"],
    [2028, 1, "2028-01-03"],
    [2021, 1, "2021-01-04"],
    [2020, 53, "2020-12-28"],
  ])("isoWeekStartKey(%i, %i) = %s", (year, week, key) => {
    expect(isoWeekStartKey(year, week)).toBe(key);
  });

  it.each([
    ["2027-01-01", 2026, 53],
    ["2025-12-29", 2026, 1],
    ["2026-01-01", 2026, 1],
    ["2021-01-03", 2020, 53],
    ["2026-10-03", 2026, 40],
  ])("isoWeekOf(%s) = %i-W%i", (key, isoYear, week) => {
    expect(isoWeekOf(key)).toEqual({ isoYear, week });
  });

  it("agrees with dayjs' isoWeek getters for every day 2018..2032", () => {
    for (let key = "2018-01-01"; key <= "2032-12-31"; key = addDays(key, 1)) {
      const ref = isoWeekOf(key);
      const zoned = toZoned(atMinutesOfDay(key, 12 * 60));
      expect(ref.week).toBe(zoned.isoWeek());
      expect(ref.isoYear).toBe(zoned.isoWeekYear());
      expect(isoWeekStartKey(ref.isoYear, ref.week)).toBe(weekDaysOf(key)[0]);
      expect(ref.week).toBeLessThanOrEqual(isoWeeksInYear(ref.isoYear));
    }
  });

  it("takes the local date of an instant", () => {
    const instant = combineDateAndTime("2027-01-01", "00:30");
    expect(isoWeekOf(instant)).toEqual({ isoYear: 2026, week: 53 });
  });
});

describe("time of day", () => {
  it("parses and formats HH:mm", () => {
    expect(minutesFromTimeOfDay("09:30")).toBe(570);
    expect(minutesFromTimeOfDay("9:05")).toBe(545);
    expect(minutesFromTimeOfDay("23:59:30")).toBe(1439.5);
    expect(timeOfDayFromMinutes(570)).toBe("09:30");
    expect(timeOfDayFromMinutes(1440 + 15)).toBe("00:15");
    expect(timeOfDayFromMinutes(-15)).toBe("23:45");
    expect(isTimeOfDay("24:00")).toBe(false);
    expect(isTimeOfDay("12:60")).toBe(false);
    expect(isTimeOfDay("12:00")).toBe(true);
  });

  it("round-trips an ordinary local time", () => {
    const instant = combineDateAndTime("2026-07-15", "09:30");
    expect(splitInstant(instant)).toEqual({ date: "2026-07-15", time: "09:30" });
    expect(minutesSinceStartOfDay(instant)).toBe(570);
    expect(atMinutesOfDay("2026-07-15", 570)).toBe(instant);
  });

  it("rolls minutes into neighbouring days", () => {
    expect(atMinutesOfDay("2026-07-15", 1440 + 60)).toBe(combineDateAndTime("2026-07-16", "01:00"));
    expect(atMinutesOfDay("2026-07-15", -60)).toBe(combineDateAndTime("2026-07-14", "23:00"));
  });

  it("moves an instant to another date keeping the wall-clock time", () => {
    const instant = combineDateAndTime("2026-07-15", "09:30");
    expect(moveToDate(instant, "2026-12-01")).toBe(combineDateAndTime("2026-12-01", "09:30"));
  });

  it("computes the end for an End-time input, rolling to the next day", () => {
    const start = combineDateAndTime("2026-07-15", "09:00");
    expect(endAtTimeOfDay(start, "10:30")).toEqual({
      end: combineDateAndTime("2026-07-15", "10:30"),
      nextDay: false,
    });
    expect(endAtTimeOfDay(start, "08:00")).toEqual({
      end: combineDateAndTime("2026-07-16", "08:00"),
      nextDay: true,
    });
    expect(endAtTimeOfDay(start, "09:00").nextDay).toBe(true);
  });
});

describe("ranges", () => {
  it("are half-open and contiguous", () => {
    const day = dayRange("2026-07-15");
    expect(day.start).toBe(startOfDayInstant("2026-07-15"));
    expect(day.end).toBe(startOfDayInstant("2026-07-16"));
    expect(isInRange(day.start, day)).toBe(true);
    expect(isInRange(day.end, day)).toBe(false);
    expect(isInRange(addMinutes(day.end, -0.001), day)).toBe(true);
  });

  it("covers a full ISO week", () => {
    const week = weekRange("2026-07-15");
    expect(week.start).toBe(startOfDayInstant("2026-07-13"));
    expect(week.end).toBe(startOfDayInstant("2026-07-20"));
  });

  it("covers whole years and month spans", () => {
    expect(yearRange(2026)).toEqual(monthsRange(2026, 0, 11));
    expect(yearRange(2026).start).toBe(startOfDayInstant("2026-01-01"));
    expect(yearRange(2026).end).toBe(startOfDayInstant("2027-01-01"));
    expect(monthsRange(2026, 1, 1)).toEqual({
      start: startOfDayInstant("2026-02-01"),
      end: startOfDayInstant("2026-03-01"),
    });
  });
});

describe("durations", () => {
  const nine = "2026-10-03T09:00:00.000Z";

  it("does elapsed-time math", () => {
    expect(addMinutes(nine, 90)).toBe("2026-10-03T10:30:00.000Z");
    expect(addHours(nine, 1.5)).toBe("2026-10-03T10:30:00.000Z");
    expect(endInstant(nine, 0.25)).toBe("2026-10-03T09:15:00.000Z");
    expect(diffMinutes("2026-10-03T10:30:00.000Z", nine)).toBe(90);
  });

  it("treats touching tasks as non-overlapping (half-open)", () => {
    expect(overlaps(nine, 1, "2026-10-03T10:00:00.000Z", 1)).toBe(false);
    expect(overlaps("2026-10-03T10:00:00.000Z", 1, nine, 1)).toBe(false);
    expect(overlaps(nine, 1.5, "2026-10-03T10:00:00.000Z", 1)).toBe(true);
    expect(overlaps(nine, 0.25, "2026-10-03T09:10:00.000Z", 0.25)).toBe(true);
    expect(overlaps(nine, 2, "2026-10-03T09:30:00.000Z", 0.5)).toBe(true);
  });

  it("places tasks on the grid", () => {
    const start = combineDateAndTime("2026-07-15", "09:00");
    expect(gridBox(start, 1.5)).toEqual({ top: 540, height: 90, endsNextDay: false });
    const late = combineDateAndTime("2026-07-15", "23:00");
    expect(gridBox(late, 1)).toEqual({ top: 1380, height: 60, endsNextDay: false });
    expect(gridBox(late, 2)).toEqual({ top: 1380, height: 120, endsNextDay: true });
  });
});

describe("now / today", () => {
  it("knows today", () => {
    expect(isDateKey(todayKey())).toBe(true);
    expect(isToday(todayKey())).toBe(true);
    expect(isToday(nowInstant())).toBe(true);
    expect(isToday(addDays(todayKey(), 1))).toBe(false);
  });

  it("measures minutes until / since", () => {
    const from = "2026-10-03T09:00:00.000Z";
    expect(minutesUntil("2026-10-03T09:20:00.000Z", from)).toBe(20);
    expect(minutesSince("2026-10-03T08:15:00.000Z", from)).toBe(45);
    expect(minutesUntil("2026-10-03T08:15:00.000Z", from)).toBe(-45);
  });

  it("finds the next local midnight", () => {
    const start = startOfDayInstant("2026-07-15");
    expect(msUntilNextLocalMidnight(start)).toBe(
      toEpochMs(startOfDayInstant("2026-07-16")) - toEpochMs(start)
    );
    expect(msUntilNextLocalMidnight(addMinutes(startOfDayInstant("2026-07-16"), -1))).toBe(60_000);
  });
});

describe("formatting", () => {
  it("formats durations compactly", () => {
    expect(formatDuration(1.5)).toBe("1h 30m");
    expect(formatDuration(0.25)).toBe("15m");
    expect(formatDuration(2)).toBe("2h");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDurationMinutes(125)).toBe("2h 5m");
    expect(formatDurationMinutes(-90)).toBe("-1h 30m");
  });

  it("formats local times in the active zone", () => {
    const morning = combineDateAndTime("2026-07-15", "09:05");
    const evening = combineDateAndTime("2026-07-15", "21:05");
    expect(formatTime(morning)).toMatch(/^0?9[:.]05(\s?AM)?$/i);
    expect(formatTime(evening)).toMatch(/^(21[:.]05|9[:.]05\s?PM)$/i);
    expect(formatTimeRange(morning, 1.5)).toBe(
      `${formatTime(morning)} – ${formatTime(combineDateAndTime("2026-07-15", "10:35"))}`
    );
    expect(formatTimeOfDay("09:05")).toBe(formatTime(morning));
    expect(formatTimeOfDay(21 * 60 + 5)).toBe(formatTime(evening));
  });

  it("labels 24 distinct grid hours", () => {
    const labels = Array.from({ length: 24 }, (_, h) => formatHourLabel(h));
    expect(new Set(labels).size).toBe(24);
  });

  it("formats calendar labels independent of the zone", () => {
    expect(formatWeekdayDay("2026-10-05")).toBe(
      `${formatWeekdayShort("2026-10-05")} ${formatDayOfMonth("2026-10-05")}`
    );
    expect(formatDayOfMonth("2026-10-05")).toBe("5");
    expect(monthNames()).toHaveLength(12);
    expect(new Set(monthNames("short")).size).toBe(12);
    expect(weekdayNames("long")[0]).toBe(
      new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" }).format(
        Date.UTC(2026, 9, 5, 12)
      )
    );
    expect(formatDate("2026-10-03", "monthYear")).toContain("2026");
    expect(formatDate(combineDateAndTime("2026-10-03", "23:30"), "monthDay")).toBe(
      formatDate("2026-10-03", "monthDay")
    );
    expect(formatDateRange("2026-09-28", "2026-10-04")).toContain("2026");
    expect(formatMonthSpan("2026-10-05", "2026-10-11")).toBe(formatDate("2026-10-05", "monthYear"));
    expect(formatMonthSpan("2026-12-28", "2027-01-03")).toMatch(/2026.*2027/);
  });

  it("formats offsets and the zone label", () => {
    const winter = Date.UTC(2026, 0, 15);
    const offset = getUtcOffsetMinutes(winter);
    const sign = offset < 0 ? "-" : "+";
    const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
    const mm = String(Math.abs(offset) % 60).padStart(2, "0");
    expect(formatUtcOffset(winter)).toBe(`UTC${sign}${hh}:${mm}`);
    expect(formatUtcOffset(winter, "short")).toBe(
      offset === 0 ? "UTC" : `UTC${sign}${Number(hh)}${mm === "00" ? "" : `:${mm}`}`
    );
    const label = formatTimeZoneLabel(winter);
    if (offset === 0) expect(label).toBe("UTC");
    else expect(label).toBe(`UTC${sign}${hh}:${mm} · ${getActiveTimeZone()}`);
  });

  it("formats relative times", () => {
    const from = "2026-10-03T09:00:00.000Z";
    const future = formatRelativeToNow("2026-10-03T09:20:00.000Z", from);
    const past = formatRelativeToNow("2026-10-03T08:40:00.000Z", from);
    expect(future).toMatch(/20/);
    expect(past).toMatch(/20/);
    expect(future).not.toBe(past);
  });
});

describe(`formatDateTime (${TEST_ZONE})`, () => {
  it("shows the local date and the local clock time of an instant", () => {
    const instant = combineDateAndTime("2026-10-11", "14:05");
    const text = formatDateTime(instant);
    expect(text).toContain("2026");
    expect(text).toContain(formatTime(instant));
    expect(text).toContain(formatDayOfMonth("2026-10-11"));
    // late evening UTC is already the next day east of UTC: the label follows the local date
    const late = "2026-12-31T23:30:00.000Z";
    expect(formatDateTime(late)).toContain(toDateKey(late).slice(0, 4));
  });
});

describe("dayjs plugin", () => {
  it("adds instant/date-key helpers to Dayjs", () => {
    const instant = combineDateAndTime("2026-07-15", "09:30");
    const zoned = toZoned(instant);
    expect(zoned.toApi()).toBe(instant);
    expect(zoned.toDateKey()).toBe("2026-07-15");
    expect(zoned.minutesIntoDay()).toBe(570);
    expect(dayjs.fromApi("2026-07-15T07:30:00").toApi()).toBe("2026-07-15T07:30:00.000Z");
    expect(dayjs.fromDateKey("2026-07-15").toApi()).toBe(startOfDayInstant("2026-07-15"));
  });
});
