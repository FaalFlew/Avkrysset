// src/composables/useClock.ts
// Reactive "today", "now" and device time zone that stay correct while a page is left open
// (midnight passes, the laptop sleeps, or the user travels to another time zone).

import { onScopeDispose, readonly, ref, watch, type Ref } from "vue";
import {
  getActiveTimeZone,
  msUntilNextLocalMidnight,
  now,
  onTimeZoneChange,
  refreshActiveTimeZone,
  todayKey,
  type DateKey,
  type EpochMs,
} from "@/lib/datetime";

/** Browsers clamp long timers; re-check at least this often. */
const MAX_TIMER_MS = 60 * 60 * 1000;
/** How often the device zone is re-checked while the page stays visible and focused. */
const ZONE_TICK_MS = 60 * 1000;

let timeZoneState: { timeZone: Readonly<Ref<string>> } | null = null;

/**
 * The device's IANA time zone as a reactive value (global singleton: one set of listeners no
 * matter how many components call it). It is re-checked on window focus, when the tab becomes
 * visible again, and once a minute; any datetime-helper call that notices a change updates it
 * too. Watch it to refetch zone-dependent data (analytics buckets, the visible week) or to
 * re-render labels: after a change every `src/lib/datetime.ts` output already uses the new zone.
 */
export function useTimeZone(): { timeZone: Readonly<Ref<string>> } {
  if (timeZoneState) return timeZoneState;

  const zone = ref(getActiveTimeZone());
  const set = (value: string) => {
    if (zone.value !== value) zone.value = value;
  };

  // A helper call can detect the change in the middle of a render: apply it in a microtask.
  onTimeZoneChange((value) => queueMicrotask(() => set(value)));

  const check = () => {
    refreshActiveTimeZone();
    set(getActiveTimeZone());
  };
  if (typeof window !== "undefined") {
    window.addEventListener("focus", check);
    setInterval(check, ZONE_TICK_MS);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
  }

  timeZoneState = { timeZone: readonly(zone) };
  return timeZoneState;
}

/**
 * Today's calendar date in the user's zone. Rolls over at local midnight (DST-aware), and is
 * re-checked when the tab becomes visible again (sleep) or the device zone changes (travel).
 */
export function useToday(): Readonly<Ref<DateKey>> {
  const today = ref<DateKey>(todayKey());
  const { timeZone } = useTimeZone();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const update = () => {
    const key = todayKey();
    if (key !== today.value) today.value = key;
  };

  const schedule = () => {
    clearTimeout(timer);
    // +250ms so the timer fires just after midnight, not just before it.
    const delay = Math.min(msUntilNextLocalMidnight() + 250, MAX_TIMER_MS);
    timer = setTimeout(() => {
      update();
      schedule();
    }, delay);
  };

  const resync = () => {
    update();
    schedule();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") resync();
  };

  schedule();
  const stopZoneWatch = watch(timeZone, resync);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  onScopeDispose(() => {
    clearTimeout(timer);
    stopZoneWatch();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  });

  return readonly(today);
}

/**
 * Current time (epoch ms), updated at the start of every minute (or every `intervalMs`),
 * e.g. for a "now" line or "starts in 20 min" labels.
 */
export function useNow(intervalMs = 60_000): Readonly<Ref<EpochMs>> {
  const current = ref<EpochMs>(now());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = () => {
    current.value = now();
    // Align to the next interval boundary (e.g. hh:mm:00 for minutes).
    timer = setTimeout(tick, intervalMs - (current.value % intervalMs) + 5);
  };
  timer = setTimeout(tick, intervalMs - (current.value % intervalMs) + 5);

  onScopeDispose(() => clearTimeout(timer));
  return readonly(current);
}
