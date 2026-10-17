/**
 * The app's single source of datetime truth.
 *
 * This is the ONLY module allowed to import `dayjs`, construct `Date` objects or call
 * `toISOString` (enforced by `src/lib/__tests__/architecture.spec.ts`). Everything else talks
 * in primitives:
 *
 * - **Instant** (`UtcIsoString`, `"2026-10-03T07:00:00.000Z"`): an absolute point in time.
 *   Every instant in memory, in localStorage and on the wire uses exactly this format.
 *   Incoming values are normalized at the boundaries (API responses, guest storage).
 * - **Calendar date** (`DateKey`, `"2026-10-03"`): a day on the wall calendar of the active
 *   time zone. Calendar arithmetic (`addDays`, ISO weeks, ...) is pure `Date.UTC` math, so it
 *   is immune to DST.
 * - **Wall-clock time** (`TimeOfDay`, `"09:30"`, or minutes since midnight): what the user sees
 *   on the clock in the active zone.
 * - **Ranges** (`InstantRange`) are half-open: `start <= t < end`. "A day" is
 *   `[start of that day, start of the next day)`, which is 23, 24 or 25 hours long
 *   (23.5/24.5 in Australia/Lord_Howe).
 *
 * Active zone: the device zone, resolved lazily from `Intl` (never at import time), and used
 * for the `X-Time-Zone` request header and all `Intl` formatting. Wall-clock math uses dayjs in
 * local mode (native `Date`), which follows the same device zone. If the device zone changes
 * while the app runs, the cached zone and formatters are re-validated on use, so every output
 * stays consistent with native `Date` (see `getActiveTimeZone`, `onTimeZoneChange`).
 *
 * DST policy (Temporal's "compatible" disambiguation), applied whenever a wall-clock time is
 * turned into an instant:
 * - **Gap** (spring forward, e.g. 02:30 in Europe/Oslo on 2026-03-29 does not exist): the time
 *   is shifted forward by the length of the gap (02:30 becomes 03:30).
 * - **Overlap** (fall back, e.g. 02:30 on 2026-10-25 happens twice): the earlier occurrence wins.
 *
 * @module
 */
import dayjs from "dayjs";
import type { Dayjs, PluginFunc } from "dayjs";
import isoWeekPlugin from "dayjs/plugin/isoWeek";
import isoWeeksInYearPlugin from "dayjs/plugin/isoWeeksInYear";
import isLeapYearPlugin from "dayjs/plugin/isLeapYear";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** An instant serialized as `YYYY-MM-DDTHH:mm:ss.sssZ` (always UTC, always milliseconds). */
export type UtcIsoString = string;
/** A calendar date in the active zone, `YYYY-MM-DD`. */
export type DateKey = string;
/** A wall-clock time of day, `HH:mm` (24h). */
export type TimeOfDay = string;
/** Milliseconds since the Unix epoch. */
export type EpochMs = number;
/** Anything that identifies an instant. Strings are parsed with {@link parseApiInstant}. */
export type InstantInput = UtcIsoString | EpochMs | Date | Dayjs;

/** Half-open range of instants: `start <= t < end`. */
export interface InstantRange {
  start: UtcIsoString;
  end: UtcIsoString;
}

/** An ISO-8601 week. `isoYear` can differ from the calendar year around New Year. */
export interface IsoWeekRef {
  isoYear: number;
  week: number;
}

/** Outcome of mapping a wall-clock time onto the timeline. See the DST policy above. */
export type WallClockStatus = "exact" | "gap" | "ambiguous";

export interface WallClockResolution {
  instant: UtcIsoString;
  status: WallClockStatus;
}

export interface DateKeyParts {
  year: number;
  /** 0-based month (0 = January), matching `monthsRange` and `monthNames`. */
  monthIndex: number;
  /** 1-based day of month. */
  day: number;
}

/** Date styles for {@link formatDate} (examples in en-US). */
export type DateStyle =
  /** "Saturday, October 3, 2026" */
  | "full"
  /** "Saturday, October 3" */
  | "weekday"
  /** "Sat, Oct 3" */
  | "weekdayShort"
  /** "October 3, 2026" */
  | "long"
  /** "Oct 3, 2026" */
  | "medium"
  /** "Oct 3" */
  | "monthDay"
  /** "October 2026" */
  | "monthYear";

// ---------------------------------------------------------------------------------------------
// dayjs registration (once, at module evaluation) + custom plugin
// ---------------------------------------------------------------------------------------------

declare module "dayjs" {
  interface Dayjs {
    /** This instant as a `UtcIsoString`. */
    toApi(): string;
    /** The calendar date of this instant in the active zone. */
    toDateKey(): string;
    /** Wall-clock minutes since local midnight (fractional for seconds). */
    minutesIntoDay(): number;
  }
  /** Parse an API instant (missing offset = UTC) into a local-mode Dayjs. */
  export function fromApi(value: string): Dayjs;
  /** Start of the given calendar day in the active zone, as a local-mode Dayjs. */
  export function fromDateKey(key: string): Dayjs;
}

const plannerPlugin: PluginFunc = (_option, dayjsClass, factory) => {
  dayjsClass.prototype.toApi = function (this: Dayjs) {
    return toApiInstant(this.valueOf());
  };
  dayjsClass.prototype.toDateKey = function (this: Dayjs) {
    return toDateKey(this.valueOf());
  };
  dayjsClass.prototype.minutesIntoDay = function (this: Dayjs) {
    return minutesSinceStartOfDay(this.valueOf());
  };
  Object.assign(factory, {
    fromApi: (value: string) => factory(parseApiInstant(value)),
    fromDateKey: (key: string) => factory(parseApiInstant(startOfDayInstant(key))),
  });
};

dayjs.extend(isoWeekPlugin);
dayjs.extend(isoWeeksInYearPlugin);
dayjs.extend(isLeapYearPlugin);
dayjs.extend(plannerPlugin);

// ---------------------------------------------------------------------------------------------
// Internal primitives
// ---------------------------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MINUTES_PER_DAY = 24 * 60;
/** 400 Gregorian years are exactly 146 097 days; used to dodge Date.UTC's 0..99 => 19xx quirk. */
const GREGORIAN_CYCLE_MS = 146_097 * DAY_MS;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_OF_DAY_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** `Date.UTC` that treats years 0..99 literally. */
function utcMs(
  year: number,
  monthIndex: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0
): number {
  if (year >= 0 && year < 100) {
    return (
      Date.UTC(year + 400, monthIndex, day, hour, minute, second, ms) -
      GREGORIAN_CYCLE_MS
    );
  }
  return Date.UTC(year, monthIndex, day, hour, minute, second, ms);
}

function pad(n: number, width = 2): string {
  return String(Math.trunc(Math.abs(n))).padStart(width, "0");
}

function daysInMonthOf(year: number, monthIndex: number): number {
  return new Date(utcMs(year, monthIndex + 1, 0)).getUTCDate();
}

interface LocalParts {
  year: number;
  monthIndex: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

/** Wall-clock components of an instant in the active zone. */
function localParts(t: EpochMs): LocalParts {
  const d = new Date(t);
  return {
    year: d.getFullYear(),
    monthIndex: d.getMonth(),
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
    ms: d.getMilliseconds(),
  };
}

/** The local wall clock of `t`, encoded as if it were a UTC timestamp. */
function wallMs(t: EpochMs): number {
  const p = localParts(t);
  return utcMs(p.year, p.monthIndex, p.day, p.hour, p.minute, p.second, p.ms);
}

/** UTC offset (ms, east positive) of the active zone at `t`. Exact, including LMT seconds. */
function offsetMsAt(t: EpochMs): number {
  return wallMs(t) - t;
}

function keyFromUtcMs(t: number): DateKey {
  const d = new Date(t);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Midnight UTC of a DateKey: the DST-free coordinate used for calendar arithmetic. */
function keyToUtcMs(key: DateKey): number {
  const { year, monthIndex, day } = dateKeyParts(key);
  return utcMs(year, monthIndex, day);
}

/** Noon UTC of a DateKey: what calendar labels are formatted at (with `timeZone: 'UTC'`). */
function keyToUtcNoon(key: DateKey): number {
  return keyToUtcMs(key) + 12 * HOUR_MS;
}

function parseTimeOfDay(time: TimeOfDay): number {
  const m = TIME_OF_DAY_RE.exec(time);
  if (!m) throw new RangeError(`Invalid time of day: "${time}"`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] ? Number(m[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) {
    throw new RangeError(`Invalid time of day: "${time}"`);
  }
  return hour * 60 + minute + second / 60;
}

/**
 * Resolve local wall-clock minutes on a calendar day to an instant.
 * Minutes outside 0..1440 roll into neighbouring days (wall-clock, not elapsed).
 */
function resolveWallMinutes(
  key: DateKey,
  minuteOfDay: number
): { ms: EpochMs; status: WallClockStatus } {
  if (!Number.isFinite(minuteOfDay)) {
    throw new RangeError(`Invalid minutes of day: ${minuteOfDay}`);
  }
  const { year, monthIndex, day } = dateKeyParts(key);
  const wholeMinutes = Math.floor(minuteOfDay);
  const extraMs = Math.round((minuteOfDay - wholeMinutes) * MINUTE_MS);
  const dayOffset = Math.floor(wholeMinutes / MINUTES_PER_DAY);
  const minutes = wholeMinutes - dayOffset * MINUTES_PER_DAY;
  const wall = utcMs(
    year,
    monthIndex,
    day + dayOffset,
    Math.floor(minutes / 60),
    minutes % 60
  );

  const offsetBefore = offsetMsAt(wall - DAY_MS);
  const offsets = new Set([offsetBefore, offsetMsAt(wall), offsetMsAt(wall + DAY_MS)]);
  const matches: number[] = [];
  for (const offset of offsets) {
    const candidate = wall - offset;
    if (wallMs(candidate) === wall) matches.push(candidate);
  }
  if (matches.length > 0) {
    return {
      ms: Math.min(...matches) + extraMs,
      status: matches.length > 1 ? "ambiguous" : "exact",
    };
  }
  // Gap: interpret with the pre-transition offset, which lands after the transition,
  // i.e. the wall-clock time is shifted forward by the length of the gap.
  return { ms: wall - offsetBefore + extraMs, status: "gap" };
}

// ---------------------------------------------------------------------------------------------
// Active time zone
// ---------------------------------------------------------------------------------------------

let activeZone: string | null = null;
/** Intl formatters keyed by their options (incl. `timeZone`); cleared when the zone changes. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();
/** Cached result of `uses12HourClock()`. */
let hourCycle12: boolean | null = null;

/**
 * The device zone can change while the tab is open (travel, OS setting). Native `Date` math
 * follows it immediately, but the cached zone id (X-Time-Zone header, labels) and every
 * `Intl.DateTimeFormat` (which fixes its zone at construction) would not. So the cached zone
 * is re-validated on use:
 * - every call compares the zone's UTC offsets at two fixed probe instants (about 1µs) and
 *   re-detects at once when they differ;
 * - the full `Intl` lookup (tens of µs) runs at most once per {@link ZONE_RECHECK_MS}, which
 *   also catches changes between zones with identical offsets (Oslo → Paris).
 * Changes are also picked up by {@link refreshActiveTimeZone}, which the app calls on focus,
 * visibility changes and a minute tick (see `useTimeZone()` in composables/useClock.ts).
 */
const ZONE_RECHECK_MS = 1000;
/** Mid-January and mid-July: standard and daylight-saving offsets of most zones. */
const ZONE_PROBES = [new Date(Date.UTC(2026, 0, 15, 12)), new Date(Date.UTC(2026, 6, 15, 12))];
let zoneSignature = "";
let zoneCheckedAt = Number.NEGATIVE_INFINITY;

type TimeZoneListener = (zone: string, previous: string) => void;
const zoneListeners = new Set<TimeZoneListener>();

function currentZoneSignature(): string {
  return ZONE_PROBES.map((probe) => probe.getTimezoneOffset()).join("|");
}

function detectTimeZone(): string {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) return zone;
  } catch {
    // Intl without time-zone support: fall through.
  }
  return "UTC";
}

/** Look the zone up again; on a change, drop zone-bound caches and notify listeners. */
function redetectZone(): boolean {
  zoneSignature = currentZoneSignature();
  zoneCheckedAt = Date.now();
  const previous = activeZone;
  const detected = detectTimeZone();
  if (detected === previous) return false;
  activeZone = detected;
  formatterCache.clear();
  if (previous === null) return false;
  for (const listener of [...zoneListeners]) {
    try {
      listener(detected, previous);
    } catch (error) {
      console.error("Time zone listener failed:", error);
    }
  }
  return true;
}

/** Cheap validation of the cached zone (see the note above). */
function syncActiveZone(): void {
  if (
    activeZone === null ||
    currentZoneSignature() !== zoneSignature ||
    Date.now() - zoneCheckedAt >= ZONE_RECHECK_MS
  ) {
    redetectZone();
  }
}

/**
 * IANA id of the zone the app works in (the device zone), e.g. `"Europe/Oslo"`.
 * Resolved lazily on first use, cached, and re-validated cheaply on every call, so it always
 * agrees with native `Date` (see above). Falls back to `"UTC"`. ICU may report legacy alias
 * names (`"Asia/Calcutta"`, `"Asia/Katmandu"`); the backend accepts them.
 */
export function getActiveTimeZone(): string {
  syncActiveZone();
  return activeZone ?? "UTC";
}

/**
 * Re-detect the device zone now (no throttling) and clear the formatter caches. Returns `true`
 * when the zone changed since it was last seen. Framework-free; `useTimeZone()` calls it on
 * window focus, when the tab becomes visible and once a minute.
 */
export function refreshActiveTimeZone(): boolean {
  const changed = redetectZone();
  formatterCache.clear();
  hourCycle12 = null;
  return changed;
}

/**
 * Subscribe to device time-zone changes (detected by any helper call or by
 * {@link refreshActiveTimeZone}). The listener may run synchronously inside such a call (even
 * during a component render), so it should only schedule work. Returns an unsubscribe function.
 */
export function onTimeZoneChange(listener: TimeZoneListener): () => void {
  zoneListeners.add(listener);
  return () => {
    zoneListeners.delete(listener);
  };
}

/** UTC offset of the active zone in minutes (east positive) at `at` (default: now). */
export function getUtcOffsetMinutes(at: InstantInput = now()): number {
  return Math.round(offsetMsAt(toEpochMs(at)) / MINUTE_MS);
}

/**
 * The active zone's UTC offset at `at` (default: now).
 * - `"long"` (default): `"UTC+02:00"`, `"UTC+05:45"`, `"UTC-03:30"`, `"UTC+00:00"`
 * - `"short"`: `"UTC+2"`, `"UTC+5:45"`, `"UTC-3:30"`, `"UTC"`
 */
export function formatUtcOffset(
  at: InstantInput = now(),
  style: "long" | "short" = "long"
): string {
  const offset = getUtcOffsetMinutes(at);
  const sign = offset < 0 ? "-" : "+";
  const hours = Math.floor(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  if (style === "short") {
    if (offset === 0) return "UTC";
    return `UTC${sign}${hours}${minutes ? `:${pad(minutes)}` : ""}`;
  }
  return `UTC${sign}${pad(hours)}:${pad(minutes)}`;
}

/** Human label for the active zone, e.g. `"UTC+02:00 · Europe/Oslo"` (just `"UTC"` for UTC). */
export function formatTimeZoneLabel(at: InstantInput = now()): string {
  const zone = getActiveTimeZone();
  if ((zone === "UTC" || zone === "Etc/UTC") && getUtcOffsetMinutes(at) === 0) {
    return "UTC";
  }
  return `${formatUtcOffset(at)} · ${zone}`;
}

/** `"+02:00"`, `"-03:30"`, `"+05:45"` for an offset in minutes. */
function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  return `${sign}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

/**
 * Distinct UTC offsets (minutes, ascending) of the active zone in force during the half-open
 * `range`: sampled every 12 hours plus the last instant, like the server's report label.
 */
export function utcOffsetsWithin(range: InstantRange): number[] {
  const start = toEpochMs(range.start);
  const end = toEpochMs(range.end);
  const offsets = new Set<number>();
  for (let t = start; t < end; t += 12 * HOUR_MS) offsets.add(getUtcOffsetMinutes(t));
  offsets.add(getUtcOffsetMinutes(end > start ? end - 1 : start));
  return [...offsets].sort((a, b) => a - b);
}

/**
 * The active zone for a report range, in the server's format: `"Europe/Oslo (UTC+02:00)"`;
 * `"Europe/Oslo (UTC+01:00/+02:00)"` when the offset changes within the range (DST); `"UTC"`.
 */
export function formatZoneLabelForRange(range: InstantRange): string {
  const zone = getActiveTimeZone();
  const offsets = utcOffsetsWithin(range);
  if (offsets.length === 1 && offsets[0] === 0 && (zone === "UTC" || zone === "Etc/UTC")) return "UTC";
  return `${zone} (UTC${offsets.map(offsetText).join("/")})`;
}

// ---------------------------------------------------------------------------------------------
// Parsing and serialization
// ---------------------------------------------------------------------------------------------

function parseInstantString(
  value: string,
  missingOffset: "utc" | "local"
): EpochMs | null {
  const m = INSTANT_RE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] ? Number(m[6]) : 0;
  const ms = m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonthOf(year, month - 1) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const zone = m[8];
  if (!zone && missingOffset === "local") {
    const key = `${m[1]}-${m[2]}-${m[3]}`;
    return resolveWallMinutes(key, hour * 60 + minute).ms + second * 1000 + ms;
  }

  let offsetMinutes = 0;
  if (zone && zone.toUpperCase() !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const offH = Number(digits.slice(0, 2));
    const offM = Number(digits.slice(2, 4));
    if (offH > 18 || offM > 59) return null;
    offsetMinutes = (zone[0] === "-" ? -1 : 1) * (offH * 60 + offM);
  }
  return (
    utcMs(year, month - 1, day, hour, minute, second, ms) - offsetMinutes * MINUTE_MS
  );
}

/**
 * Parse an instant received from the API. Engine-independent (no `Date.parse`).
 * Accepts `Z`, `±HH:mm`/`±HHmm` offsets, a space instead of `T`, optional seconds and any number
 * of fraction digits (.NET sends 7; extra digits are truncated to milliseconds).
 * **A missing offset means UTC** (the legacy backend omitted the `Z`).
 * @throws RangeError when the value is not a valid instant.
 */
export function parseApiInstant(value: string): EpochMs {
  const ms = typeof value === "string" ? parseInstantString(value, "utc") : null;
  if (ms === null) throw new RangeError(`Invalid API instant: "${String(value)}"`);
  return ms;
}

/** Like {@link parseApiInstant} but returns `null` instead of throwing. */
export function tryParseApiInstant(value: unknown): EpochMs | null {
  return typeof value === "string" ? parseInstantString(value, "utc") : null;
}

/** `true` when `value` is a string {@link parseApiInstant} accepts. */
export function isValidApiInstant(value: unknown): value is string {
  return tryParseApiInstant(value) !== null;
}

/**
 * Parse an instant read from guest storage or other legacy sources.
 * Same grammar as {@link parseApiInstant}, plus a bare `YYYY-MM-DD` (start of that day), but
 * **a missing offset means wall-clock time in the active zone** (old guest data was saved as
 * `"YYYY-MM-DD HH:mm:ss"` local time).
 * @throws RangeError when the value is not a valid instant.
 */
export function parseStoredInstant(value: string): EpochMs {
  if (typeof value === "string" && isDateKey(value.trim())) {
    return resolveWallMinutes(value.trim(), 0).ms;
  }
  const ms = typeof value === "string" ? parseInstantString(value, "local") : null;
  if (ms === null) throw new RangeError(`Invalid stored instant: "${String(value)}"`);
  return ms;
}

/** Canonical `UtcIsoString` for an API value (missing offset = UTC). @throws RangeError */
export function normalizeApiInstant(value: string): UtcIsoString {
  return toApiInstant(parseApiInstant(value));
}

/** Canonical `UtcIsoString` for a stored/legacy value (missing offset = local), or `null`. */
export function normalizeStoredInstant(value: unknown): UtcIsoString | null {
  if (typeof value !== "string") return null;
  try {
    return toApiInstant(parseStoredInstant(value));
  } catch {
    return null;
  }
}

/** Epoch milliseconds of any instant input. Strings use API semantics. @throws RangeError */
export function toEpochMs(value: InstantInput): EpochMs {
  let ms: number;
  if (typeof value === "number") ms = value;
  else if (typeof value === "string") ms = parseApiInstant(value);
  else if (value instanceof Date) ms = value.getTime();
  else if (dayjs.isDayjs(value)) ms = value.valueOf();
  else throw new RangeError(`Unsupported instant: ${String(value)}`);
  if (!Number.isFinite(ms)) throw new RangeError(`Invalid instant: ${String(value)}`);
  return ms;
}

/** Serialize an instant as `YYYY-MM-DDTHH:mm:ss.sssZ` (byte-identical to the backend). */
export function toApiInstant(value: InstantInput): UtcIsoString {
  return new Date(toEpochMs(value)).toISOString();
}

/**
 * A local-mode Dayjs for an instant, for the rare case a component needs Dayjs itself.
 * Strings use API semantics. Prefer the primitive helpers in this module.
 */
export function toZoned(value: InstantInput): Dayjs {
  return dayjs(toEpochMs(value));
}

/** Comparator for sorting instants ascending (negative when `a` is earlier). */
export function compareInstants(a: InstantInput, b: InstantInput): number {
  return toEpochMs(a) - toEpochMs(b);
}

// ---------------------------------------------------------------------------------------------
// Now / today
// ---------------------------------------------------------------------------------------------

/** Current time in epoch milliseconds. */
export function now(): EpochMs {
  return Date.now();
}

/** Current time as a `UtcIsoString`. */
export function nowInstant(): UtcIsoString {
  return toApiInstant(now());
}

/** Today's calendar date in the active zone. */
export function todayKey(): DateKey {
  return toDateKey(now());
}

/** `true` when the instant (or DateKey) falls on today's calendar date in the active zone. */
export function isToday(value: InstantInput | DateKey): boolean {
  return toDateKey(value) === todayKey();
}

/** Minutes from `from` (default now) until `value`; negative when `value` is in the past. */
export function minutesUntil(value: InstantInput, from: InstantInput = now()): number {
  return (toEpochMs(value) - toEpochMs(from)) / MINUTE_MS;
}

/** Minutes elapsed since `value` until `from` (default now); negative for future values. */
export function minutesSince(value: InstantInput, from: InstantInput = now()): number {
  return -minutesUntil(value, from);
}

/** Milliseconds until the next local midnight (start of tomorrow, DST-aware). */
export function msUntilNextLocalMidnight(from: InstantInput = now()): number {
  const fromMs = toEpochMs(from);
  return parseApiInstant(startOfDayInstant(addDays(toDateKey(fromMs), 1))) - fromMs;
}

// ---------------------------------------------------------------------------------------------
// Calendar dates (pure Date.UTC arithmetic, DST-immune)
// ---------------------------------------------------------------------------------------------

/** `true` for a valid `YYYY-MM-DD` calendar date. */
export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string") return false;
  const m = DATE_KEY_RE.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonthOf(Number(m[1]), month - 1);
}

/** Components of a DateKey (`monthIndex` is 0-based). @throws RangeError */
export function dateKeyParts(key: DateKey): DateKeyParts {
  if (!isDateKey(key)) throw new RangeError(`Invalid date key: "${String(key)}"`);
  return {
    year: Number(key.slice(0, 4)),
    monthIndex: Number(key.slice(5, 7)) - 1,
    day: Number(key.slice(8, 10)),
  };
}

/** Build a DateKey; out-of-range months/days roll over like `Date.UTC`. */
export function dateKeyFromParts(year: number, monthIndex: number, day: number): DateKey {
  return keyFromUtcMs(utcMs(year, monthIndex, day));
}

/**
 * Calendar date of an instant in the active zone. A DateKey is returned unchanged, so
 * `toDateKey(keyOrInstant)` is safe for mixed inputs.
 */
export function toDateKey(value: InstantInput | DateKey): DateKey {
  if (typeof value === "string" && isDateKey(value)) return value;
  const p = localParts(toEpochMs(value));
  return `${pad(p.year, 4)}-${pad(p.monthIndex + 1)}-${pad(p.day)}`;
}

/** `key` plus `days` calendar days (negative to go back). */
export function addDays(key: DateKey, days: number): DateKey {
  return keyFromUtcMs(keyToUtcMs(key) + Math.round(days) * DAY_MS);
}

/** `key` plus `months` months; the day is clamped to the target month's length. */
export function addMonths(key: DateKey, months: number): DateKey {
  const { year, monthIndex, day } = dateKeyParts(key);
  const total = year * 12 + monthIndex + Math.round(months);
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  return dateKeyFromParts(y, m, Math.min(day, daysInMonthOf(y, m)));
}

/** Number of days in a month (`monthIndex` 0-based). */
export function daysInMonth(year: number, monthIndex: number): number {
  return daysInMonthOf(year, monthIndex);
}

/** Calendar days from `b` to `a` (`a - b`), e.g. `diffCalendarDays("2026-10-05", "2026-10-03") === 2`. */
export function diffCalendarDays(a: DateKey, b: DateKey): number {
  return Math.round((keyToUtcMs(a) - keyToUtcMs(b)) / DAY_MS);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(key: DateKey): number {
  return ((new Date(keyToUtcMs(key)).getUTCDay() + 6) % 7) + 1;
}

/** The ISO week containing a calendar date (or the local date of an instant). */
export function isoWeekOf(value: DateKey | InstantInput): IsoWeekRef {
  const key = toDateKey(value);
  const thursday = keyToUtcMs(key) + (4 - isoWeekday(key)) * DAY_MS;
  const isoYear = new Date(thursday).getUTCFullYear();
  const dayOfYear = Math.round((thursday - utcMs(isoYear, 0, 1)) / DAY_MS);
  return { isoYear, week: Math.floor(dayOfYear / 7) + 1 };
}

/**
 * Monday of ISO week `week` of `isoYear`: the Monday of the week containing January 4th, plus
 * `(week - 1) * 7` days. (Never use dayjs' `isoWeek(n)` setter for this; it is relative to the
 * current date's week-year.)
 */
export function isoWeekStartKey(isoYear: number, week: number): DateKey {
  const jan4 = dateKeyFromParts(isoYear, 0, 4);
  return addDays(jan4, 1 - isoWeekday(jan4) + (week - 1) * 7);
}

/** Number of ISO weeks in an ISO week-year: 52 or 53 (2026 has 53). */
export function isoWeeksInYear(isoYear: number): number {
  return isoWeekOf(dateKeyFromParts(isoYear, 11, 28)).week;
}

/** The 7 calendar dates (Monday..Sunday) of the ISO week containing `key`. */
export function weekDaysOf(key: DateKey): DateKey[] {
  const monday = addDays(key, 1 - isoWeekday(key));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * Rows of a Monday-first month calendar: every ISO week that touches the month, with its
 * 7 dates (including leading/trailing days of the neighbouring months).
 */
export function monthGrid(
  year: number,
  monthIndex: number
): { week: IsoWeekRef; days: DateKey[] }[] {
  const first = dateKeyFromParts(year, monthIndex, 1);
  const last = dateKeyFromParts(year, monthIndex, daysInMonthOf(year, monthIndex));
  const rows: { week: IsoWeekRef; days: DateKey[] }[] = [];
  for (let monday = weekDaysOf(first)[0]; monday <= last; monday = addDays(monday, 7)) {
    rows.push({ week: isoWeekOf(monday), days: weekDaysOf(monday) });
  }
  return rows;
}

/** Bucket key of a month: `"2026-03"` (`monthIndex` 0-based). */
export function monthKey(year: number, monthIndex: number): string {
  return dateKeyFromParts(year, monthIndex, 1).slice(0, 7);
}

/** Bucket key of the local month of an instant or DateKey: `"2026-03"`. */
export function monthKeyOf(value: DateKey | InstantInput): string {
  return toDateKey(value).slice(0, 7);
}

/** Bucket key of an ISO week: `"2026-W05"` (same format as the API's weekly `key`). */
export function isoWeekKey(ref: IsoWeekRef): string {
  return `${pad(ref.isoYear, 4)}-W${pad(ref.week)}`;
}

// ---------------------------------------------------------------------------------------------
// Ranges (half-open, as UTC instants)
// ---------------------------------------------------------------------------------------------

/**
 * First instant of a calendar day in the active zone. Usually local midnight; if midnight
 * falls into a DST gap (e.g. America/Sao_Paulo 2018-11-04) it is the first existing time (01:00).
 */
export function startOfDayInstant(key: DateKey): UtcIsoString {
  return toApiInstant(resolveWallMinutes(key, 0).ms);
}

/** `[start of key, start of next day)`. */
export function dayRange(key: DateKey): InstantRange {
  return { start: startOfDayInstant(key), end: startOfDayInstant(addDays(key, 1)) };
}

/** The ISO week (Monday..Sunday) containing `key`. */
export function weekRange(key: DateKey): InstantRange {
  const monday = weekDaysOf(key)[0];
  return { start: startOfDayInstant(monday), end: startOfDayInstant(addDays(monday, 7)) };
}

/** ISO weeks `fromWeek..toWeek` (inclusive) of `isoYear`. */
export function isoWeeksRange(isoYear: number, fromWeek: number, toWeek: number): InstantRange {
  return {
    start: startOfDayInstant(isoWeekStartKey(isoYear, fromWeek)),
    end: startOfDayInstant(addDays(isoWeekStartKey(isoYear, toWeek), 7)),
  };
}

/** Months `fromMonth..toMonth` (inclusive, 0-based) of `year`. */
export function monthsRange(year: number, fromMonth: number, toMonth: number): InstantRange {
  return {
    start: startOfDayInstant(dateKeyFromParts(year, fromMonth, 1)),
    end: startOfDayInstant(dateKeyFromParts(year, toMonth + 1, 1)),
  };
}

/** The whole calendar year. */
export function yearRange(year: number): InstantRange {
  return monthsRange(year, 0, 11);
}

/** `range.start <= value < range.end`. */
export function isInRange(value: InstantInput, range: InstantRange): boolean {
  const t = toEpochMs(value);
  return t >= parseApiInstant(range.start) && t < parseApiInstant(range.end);
}

// ---------------------------------------------------------------------------------------------
// Wall clock <-> instant
// ---------------------------------------------------------------------------------------------

/** `true` for `H:mm`, `HH:mm` or `HH:mm:ss` within a day. */
export function isTimeOfDay(value: unknown): value is TimeOfDay {
  if (typeof value !== "string") return false;
  try {
    parseTimeOfDay(value);
    return true;
  } catch {
    return false;
  }
}

/** `"HH:mm"` -> minutes since midnight. @throws RangeError */
export function minutesFromTimeOfDay(time: TimeOfDay): number {
  return parseTimeOfDay(time);
}

/** Minutes since midnight -> `"HH:mm"` (wrapped into 0..1439, seconds dropped). */
export function timeOfDayFromMinutes(minutes: number): TimeOfDay {
  const m = ((Math.floor(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/**
 * Map a wall-clock time on a calendar day to an instant, reporting DST trouble:
 * `"gap"` = the time does not exist (shifted forward), `"ambiguous"` = it exists twice
 * (earlier occurrence chosen).
 */
export function resolveWallClock(key: DateKey, time: TimeOfDay): WallClockResolution {
  const { ms, status } = resolveWallMinutes(key, parseTimeOfDay(time));
  return { instant: toApiInstant(ms), status };
}

/** `resolveWallClock(key, time).instant`: what a date + time input pair means. */
export function combineDateAndTime(key: DateKey, time: TimeOfDay): UtcIsoString {
  return resolveWallClock(key, time).instant;
}

/** Local calendar date and `HH:mm` of an instant (inverse of {@link combineDateAndTime}). */
export function splitInstant(value: InstantInput): { date: DateKey; time: TimeOfDay } {
  const p = localParts(toEpochMs(value));
  return {
    date: `${pad(p.year, 4)}-${pad(p.monthIndex + 1)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/**
 * Wall-clock minutes since local midnight (`h * 60 + m`, fractional for seconds). This is the
 * vertical grid coordinate: on DST days it is NOT the elapsed time since the day started.
 */
export function minutesSinceStartOfDay(value: InstantInput): number {
  const p = localParts(toEpochMs(value));
  return p.hour * 60 + p.minute + (p.second * 1000 + p.ms) / MINUTE_MS;
}

/**
 * The instant at wall-clock `minutes` after midnight of `key`. Values below 0 or at/after 1440
 * roll into the neighbouring days by wall clock. DST gaps/overlaps follow the module policy.
 */
export function atMinutesOfDay(key: DateKey, minutes: number): UtcIsoString {
  return toApiInstant(resolveWallMinutes(key, minutes).ms);
}

/** Same wall-clock time as `value`, on calendar date `key`. */
export function moveToDate(value: InstantInput, key: DateKey): UtcIsoString {
  return atMinutesOfDay(key, minutesSinceStartOfDay(value));
}

/**
 * End instant for an "End" time input: the next occurrence of `endTime` after `start` on the
 * same day, or on the following day when `endTime` is at or before the start time.
 */
export function endAtTimeOfDay(
  start: InstantInput,
  endTime: TimeOfDay
): { end: UtcIsoString; nextDay: boolean } {
  const startMs = toEpochMs(start);
  const startKey = toDateKey(startMs);
  const sameDay = resolveWallMinutes(startKey, parseTimeOfDay(endTime)).ms;
  if (sameDay > startMs) return { end: toApiInstant(sameDay), nextDay: false };
  return {
    end: toApiInstant(resolveWallMinutes(addDays(startKey, 1), parseTimeOfDay(endTime)).ms),
    nextDay: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Durations (absolute / elapsed time)
// ---------------------------------------------------------------------------------------------

/** `value` plus `minutes` of elapsed time. */
export function addMinutes(value: InstantInput, minutes: number): UtcIsoString {
  return toApiInstant(toEpochMs(value) + Math.round(minutes * MINUTE_MS));
}

/** `value` plus `hours` of elapsed time. */
export function addHours(value: InstantInput, hours: number): UtcIsoString {
  return toApiInstant(toEpochMs(value) + Math.round(hours * HOUR_MS));
}

/** End of a task: `start + hours` of elapsed time. */
export function endInstant(start: InstantInput, hours: number): UtcIsoString {
  return addHours(start, hours);
}

/** Elapsed minutes `a - b` (positive when `a` is later). */
export function diffMinutes(a: InstantInput, b: InstantInput): number {
  return (toEpochMs(a) - toEpochMs(b)) / MINUTE_MS;
}

/**
 * Do two tasks overlap? Half-open: a task ending at 10:00 and one starting at 10:00 do not.
 * Same rule as the server.
 */
export function overlaps(
  aStart: InstantInput,
  aHours: number,
  bStart: InstantInput,
  bHours: number
): boolean {
  const a0 = toEpochMs(aStart);
  const b0 = toEpochMs(bStart);
  const a1 = a0 + Math.round(aHours * HOUR_MS);
  const b1 = b0 + Math.round(bHours * HOUR_MS);
  return a0 < b1 && b0 < a1;
}

/**
 * Vertical placement of a task in a day column, in wall-clock minutes (multiply by
 * pixels-per-minute). `top` is the wall-clock start; `height` is the wall-clock span when the
 * task ends later the same day (so blocks line up with hour labels on DST days), otherwise the
 * elapsed duration. `endsNextDay` lets the UI clamp/mark blocks that continue past midnight.
 */
export function gridBox(
  start: InstantInput,
  hours: number
): { top: number; height: number; endsNextDay: boolean } {
  const startMs = toEpochMs(start);
  const endMs = startMs + Math.round(hours * HOUR_MS);
  const top = minutesSinceStartOfDay(startMs);
  const nextDayStart = resolveWallMinutes(addDays(toDateKey(startMs), 1), 0).ms;
  const endsNextDay = endMs > nextDayStart;
  const wallEnd = endMs === nextDayStart ? MINUTES_PER_DAY : minutesSinceStartOfDay(endMs);
  const wallSpan = wallEnd - top;
  const height = !endsNextDay && wallSpan > 0 ? wallSpan : hours * 60;
  return { top, height, endsNextDay };
}

// ---------------------------------------------------------------------------------------------
// Formatting (Intl, browser locale)
// ---------------------------------------------------------------------------------------------

/** Locale for all display formatting: `undefined` = the browser's locale (24h/12h follows it). */
export const DISPLAY_LOCALE: string | undefined = undefined;

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = JSON.stringify(options);
  let f = formatterCache.get(cacheKey);
  if (!f) {
    f = new Intl.DateTimeFormat(DISPLAY_LOCALE, options);
    formatterCache.set(cacheKey, f);
  }
  return f;
}

/** Formatter for instants, in the active zone. */
function instantFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return formatter({ ...options, timeZone: getActiveTimeZone() });
}

/** Formatter for calendar labels: applied at UTC noon with `timeZone: 'UTC'` (DST-proof). */
function calendarFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return formatter({ ...options, timeZone: "UTC" });
}

function timeOptions(): Intl.DateTimeFormatOptions {
  return uses12HourClock()
    ? { hour: "numeric", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
}

/** `true` when the display locale uses a 12-hour clock (en-US), `false` for 24h (en-GB, nb). */
export function uses12HourClock(): boolean {
  if (hourCycle12 === null) {
    // A 12-hour clock is the one that prints a day period (AM/PM).
    hourCycle12 = new Intl.DateTimeFormat(DISPLAY_LOCALE, { hour: "numeric", timeZone: "UTC" })
      .formatToParts(utcMs(2000, 0, 1, 15))
      .some((part) => part.type === "dayPeriod");
  }
  return hourCycle12;
}

/** Local time of an instant: `"09:30"` or `"9:30 AM"` depending on the locale. */
export function formatTime(value: InstantInput): string {
  return instantFormatter(timeOptions()).format(toEpochMs(value));
}

/**
 * Local date and time of an instant (medium date + the locale's clock):
 * `"Oct 11, 2026, 14:05"` / `"Oct 11, 2026, 2:05 PM"` / `"11. okt. 2026, 14:05"`.
 */
export function formatDateTime(value: InstantInput): string {
  return instantFormatter({ year: "numeric", month: "short", day: "numeric", ...timeOptions() }).format(
    toEpochMs(value)
  );
}

/** `"09:00 – 10:30"`: start and `start + hours`, both in local time. */
export function formatTimeRange(start: InstantInput, hours: number): string {
  return `${formatTime(start)} – ${formatTime(endInstant(start, hours))}`;
}

/** Wall-clock `"HH:mm"` (`"9:30 AM"` in 12h locales) for minutes since midnight. */
export function formatTimeOfDay(minutesOrTime: number | TimeOfDay): string {
  const minutes =
    typeof minutesOrTime === "number" ? minutesOrTime : parseTimeOfDay(minutesOrTime);
  const m = ((Math.floor(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return calendarFormatter(timeOptions()).format(
    utcMs(2000, 0, 1, Math.floor(m / 60), m % 60)
  );
}

/**
 * Label for a grid hour row (0..23): `"09:00"` in 24h locales, `"9 AM"` in 12h locales.
 * Independent of DST (labels are wall-clock rows, not instants).
 */
export function formatHourLabel(hour: number): string {
  const options: Intl.DateTimeFormatOptions = uses12HourClock()
    ? { hour: "numeric" }
    : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  return calendarFormatter(options).format(utcMs(2000, 0, 1, hour));
}

/** `"Mon"` */
export function formatWeekdayShort(key: DateKey): string {
  return calendarFormatter({ weekday: "short" }).format(keyToUtcNoon(key));
}

/** `"Monday"` */
export function formatWeekdayLong(key: DateKey): string {
  return calendarFormatter({ weekday: "long" }).format(keyToUtcNoon(key));
}

/** `"5"` */
export function formatDayOfMonth(key: DateKey): string {
  return calendarFormatter({ day: "numeric" }).format(keyToUtcNoon(key));
}

/** `"Mon 5"` (chart/day labels). */
export function formatWeekdayDay(key: DateKey): string {
  return `${formatWeekdayShort(key)} ${formatDayOfMonth(key)}`;
}

const DATE_STYLE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  full: { weekday: "long", year: "numeric", month: "long", day: "numeric" },
  weekday: { weekday: "long", month: "long", day: "numeric" },
  weekdayShort: { weekday: "short", month: "short", day: "numeric" },
  long: { year: "numeric", month: "long", day: "numeric" },
  medium: { year: "numeric", month: "short", day: "numeric" },
  monthDay: { month: "short", day: "numeric" },
  monthYear: { year: "numeric", month: "long" },
};

/**
 * Format a calendar date (or the local date of an instant). See {@link DateStyle}.
 * `formatDate(todayKey(), "weekday")` -> `"Saturday, October 3"`.
 */
export function formatDate(value: DateKey | InstantInput, style: DateStyle = "medium"): string {
  return calendarFormatter(DATE_STYLE_OPTIONS[style]).format(keyToUtcNoon(toDateKey(value)));
}

/** `"March 2026"` (`monthIndex` 0-based). */
export function formatMonthYear(year: number, monthIndex: number): string {
  return formatDate(dateKeyFromParts(year, monthIndex, 1), "monthYear");
}

type RangeFormatter = Intl.DateTimeFormat & {
  formatRange?: (start: number, end: number) => string;
};

function formatCalendarRange(
  options: Intl.DateTimeFormatOptions,
  startKey: DateKey,
  endKey: DateKey,
  fallback: () => string
): string {
  const f = calendarFormatter(options) as RangeFormatter;
  if (typeof f.formatRange === "function") {
    return f.formatRange(keyToUtcNoon(startKey), keyToUtcNoon(endKey));
  }
  return fallback();
}

/** Inclusive date range, locale-aware: `"Sep 28 – Oct 4, 2026"`. */
export function formatDateRange(startKey: DateKey, endKey: DateKey): string {
  if (startKey === endKey) return formatDate(startKey, "medium");
  return formatCalendarRange(
    { year: "numeric", month: "short", day: "numeric" },
    startKey,
    endKey,
    () => `${formatDate(startKey, "monthDay")} – ${formatDate(endKey, "medium")}`
  );
}

/**
 * Month(s) covered by a span of dates, for a planner title:
 * `"October 2026"`, `"Sep – Oct 2026"`, `"Dec 2026 – Jan 2027"`.
 */
export function formatMonthSpan(startKey: DateKey, endKey: DateKey): string {
  if (startKey.slice(0, 7) === endKey.slice(0, 7)) return formatDate(startKey, "monthYear");
  return formatCalendarRange(
    { year: "numeric", month: "short" },
    startKey,
    endKey,
    () =>
      `${calendarFormatter({ month: "short" }).format(keyToUtcNoon(startKey))} – ${calendarFormatter(
        { year: "numeric", month: "short" }
      ).format(keyToUtcNoon(endKey))}`
  );
}

/** The 12 month names in the display locale, January first. */
export function monthNames(style: "long" | "short" = "long"): string[] {
  const f = calendarFormatter({ month: style });
  return Array.from({ length: 12 }, (_, m) => f.format(utcMs(2000, m, 15, 12)));
}

/** The 7 weekday names in the display locale, Monday first. */
export function weekdayNames(style: "long" | "short" | "narrow" = "short"): string[] {
  const f = calendarFormatter({ weekday: style });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => f.format(utcMs(2024, 0, 1 + i, 12)));
}

/** `"W5"` (short) or `"Week 5"` (long). */
export function formatWeekNumber(week: number, style: "short" | "long" = "long"): string {
  return style === "short" ? `W${week}` : `Week ${week}`;
}

/** Compact duration for minutes: `"15m"`, `"1h"`, `"1h 30m"`, `"0m"`. Rounded to whole minutes. */
export function formatDurationMinutes(minutes: number): string {
  const total = Math.round(Math.abs(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const sign = minutes < 0 && total > 0 ? "-" : "";
  if (h === 0) return `${sign}${m}m`;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}m`;
}

/** Compact duration for (task) hours: `formatDuration(1.5) === "1h 30m"`. */
export function formatDuration(hours: number): string {
  return formatDurationMinutes(hours * 60);
}

/**
 * Locale-aware relative time to `value` from `from` (default now): `"in 20 minutes"`,
 * `"5 minutes ago"`, `"now"`, `"in 3 hours"`, `"tomorrow"`.
 */
export function formatRelativeToNow(value: InstantInput, from: InstantInput = now()): string {
  const rtf = new Intl.RelativeTimeFormat(DISPLAY_LOCALE, { numeric: "auto" });
  const minutes = minutesUntil(value, from);
  const abs = Math.abs(minutes);
  if (abs < 1) return rtf.format(0, "second");
  if (abs < 60) return rtf.format(Math.round(minutes), "minute");
  if (abs < 24 * 60) return rtf.format(Math.round(minutes / 60), "hour");
  return rtf.format(
    diffCalendarDays(toDateKey(value), toDateKey(from)),
    "day"
  );
}
