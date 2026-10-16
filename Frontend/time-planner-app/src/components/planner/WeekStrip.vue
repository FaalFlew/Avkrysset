<script setup lang="ts">
/**
 * WeekStrip — phone day strip under the planner header: a horizontally scrollable row of day
 * pills across ISO weeks, each week led by its number ("W42"). One week fills the width and
 * scroll-snap stops at every Monday, so a settled strip shows exactly Mon–Sun of one week.
 * Native touch scrolling only reveals days; tapping a day (or Enter/Space) selects it. When the
 * selected day changes elsewhere (grid swipe, Today, J/K, week picker) the strip scrolls to its
 * week. Only a window of 13 weeks is rendered; it is re-centred (with a scroll rebase, so nothing
 * jumps) once scrolling settles near either end. Logic and numbers: planner/dayStrip.ts.
 * Selected day: accent fill. Today: accent text, semibold. A 4px dot marks days with tasks.
 * Keyboard (listbox, roving tabindex): ←/→ day, Home/End week start/end, PageUp/PageDown week.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DateKey } from "@/lib/datetime";
import { useBreakpoint } from "@/composables/useMediaQuery";
import {
  STRIP,
  moveStripFocus,
  planReveal,
  rebasedScrollLeft,
  recenterStrip,
  shownWeekIndex,
  stripDayAriaLabel,
  stripTabStop,
  stripWeeks,
  stripWindowAround,
  weekIndexOf,
  type StripWindow,
} from "@/components/planner/dayStrip";

const props = defineProps<{
  selected: DateKey;
  today: DateKey;
  /** Days that have at least one task. */
  busyDays: ReadonlySet<DateKey>;
}>();

const emit = defineEmits<{ select: [day: DateKey] }>();

const { prefersReducedMotion } = useBreakpoint();

const scroller = ref<HTMLElement | null>(null);
/** The rendered weeks. */
const strip = ref<StripWindow>(stripWindowAround(props.selected));
const weeks = computed(() => stripWeeks(strip.value));
/** Index of the week on screen (updated when scrolling settles; read only as a tab-stop fallback). */
const shownIndex = ref(weekIndexOf(strip.value, props.selected));
/** The day with keyboard focus while focus is inside the strip. */
const focused = ref<DateKey | null>(null);
const tabStop = computed(() => stripTabStop(strip.value, focused.value, props.selected, () => shownIndex.value));

/** Width of one week = the strip's width; measured on mount/resize, never while scrolling. */
let weekWidth = 0;
let settleTimer: number | undefined;
let touching = false;
let resizeObserver: ResizeObserver | null = null;

// ------------------------------------------------------------------ revealing a day
/** Bring `day`'s week on screen: smooth (instant under reduced motion); a rebuild jumps. */
async function reveal(day: DateKey): Promise<void> {
  const el = scroller.value;
  if (!el) return;
  const plan = planReveal(strip.value, day, weekWidth, el.scrollLeft);
  if (plan.kind === "none") return;
  if (plan.kind === "rebuild") {
    strip.value = plan.window;
    shownIndex.value = weekIndexOf(plan.window, day);
    await nextTick();
    el.scrollLeft = plan.left;
    return;
  }
  el.scrollTo({ left: plan.left, behavior: prefersReducedMotion.value ? "auto" : "smooth" });
}

watch(
  () => props.selected,
  (day) => void reveal(day)
);

/** Show the selected day again, e.g. "Today" while today is already selected but scrolled away. */
function revealSelected(): void {
  void reveal(props.selected);
}

defineExpose({ revealSelected });

// ------------------------------------------------------------------ scrolling & re-centring
function scheduleSettle(): void {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => void settle(), STRIP.settleMs);
}

function onScroll(): void {
  // Nothing else here: no layout reads or reactive writes while the strip moves.
  scheduleSettle();
}

function onScrollEnd(): void {
  window.clearTimeout(settleTimer);
  void settle();
}

function onTouchStart(): void {
  touching = true;
  window.clearTimeout(settleTimer);
}

function onTouchEnd(event: TouchEvent): void {
  if (event.touches.length > 0) return;
  touching = false;
  scheduleSettle();
}

/** Scrolling stopped (and no finger is down): re-centre the window when near either end. */
async function settle(): Promise<void> {
  const el = scroller.value;
  if (!el || touching || !(weekWidth > 0)) return;
  const left = el.scrollLeft;
  const index = shownWeekIndex(left, weekWidth, strip.value.weeks);
  shownIndex.value = index;
  const next = recenterStrip(strip.value, index);
  if (!next) return;
  const from = strip.value;
  strip.value = next.window;
  shownIndex.value = next.shownIndex;
  await nextTick();
  // Patched, not painted yet: rebase by the weeks added/removed in front, so nothing moves.
  el.scrollLeft = rebasedScrollLeft(left, weekWidth, from, next.window);
}

// ------------------------------------------------------------------ keyboard
function dayOf(target: EventTarget | null): DateKey | null {
  return target instanceof HTMLElement ? (target.dataset.day ?? null) : null;
}

async function onKeydown(event: KeyboardEvent): Promise<void> {
  const from = dayOf(event.target);
  if (!from || event.altKey || event.ctrlKey || event.metaKey) return;
  const to = moveStripFocus(from, event.key);
  if (!to) return;
  event.preventDefault();
  focused.value = to;
  await reveal(to);
  await nextTick();
  scroller.value?.querySelector<HTMLElement>(`[data-day="${to}"]`)?.focus({ preventScroll: true });
}

function onFocusIn(event: FocusEvent): void {
  const day = dayOf(event.target);
  if (day) focused.value = day;
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  // Leaving the strip: Tab comes back to the selected day.
  if (!(next instanceof Node) || !scroller.value?.contains(next)) focused.value = null;
}

// ------------------------------------------------------------------ lifecycle
onMounted(() => {
  const el = scroller.value;
  if (!el) return;
  weekWidth = el.clientWidth;
  el.scrollLeft = shownIndex.value * weekWidth;
  el.addEventListener("scroll", onScroll, { passive: true });
  el.addEventListener("scrollend", onScrollEnd, { passive: true });
  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchend", onTouchEnd, { passive: true });
  el.addEventListener("touchcancel", onTouchEnd, { passive: true });
  resizeObserver = new ResizeObserver(() => {
    const width = el.clientWidth;
    if (width === weekWidth) return;
    // Rotation / resize: keep the same week on screen at the new width.
    weekWidth = width;
    el.scrollLeft = shownIndex.value * weekWidth;
  });
  resizeObserver.observe(el);
});

onBeforeUnmount(() => {
  window.clearTimeout(settleTimer);
  resizeObserver?.disconnect();
  const el = scroller.value;
  if (!el) return;
  el.removeEventListener("scroll", onScroll);
  el.removeEventListener("scrollend", onScrollEnd);
  el.removeEventListener("touchstart", onTouchStart);
  el.removeEventListener("touchend", onTouchEnd);
  el.removeEventListener("touchcancel", onTouchEnd);
});
</script>

<template>
  <div class="week-strip">
    <div
      ref="scroller"
      class="week-strip__scroller"
      role="listbox"
      aria-label="Days"
      aria-orientation="horizontal"
      @keydown="onKeydown"
      @focusin="onFocusIn"
      @focusout="onFocusOut"
    >
      <div v-for="week in weeks" :key="week.monday" class="strip-week" role="group" :aria-label="week.ariaLabel">
        <span class="strip-week__number tabular" aria-hidden="true">{{ week.label }}</span>
        <button
          v-for="day in week.days"
          :key="day.key"
          type="button"
          role="option"
          class="day-pill"
          :class="{ 'is-selected': day.key === selected, 'is-today': day.key === today }"
          :data-day="day.key"
          :tabindex="day.key === tabStop ? 0 : -1"
          :aria-selected="day.key === selected"
          :aria-label="stripDayAriaLabel(day.label, day.key === today, busyDays.has(day.key))"
          @click="emit('select', day.key)"
        >
          <span class="day-pill__weekday" aria-hidden="true">{{ day.weekday }}</span>
          <span class="day-pill__date tabular" aria-hidden="true">{{ day.date }}</span>
          <span class="day-pill__dot" :class="{ 'is-visible': busyDays.has(day.key) }" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 60px on touch (1px border + 4px + 51px pills + 4px); a mouse scrollbar adds its own height. */
.week-strip {
  border-bottom: 1px solid var(--border-subtle);
  background-color: var(--bg-app);
  flex-shrink: 0;
}
.week-strip__scroller {
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  /* One week per screen; a fling may pass several weeks (scroll-snap-stop: normal). */
  scroll-snap-type: x mandatory;
  /* No scroll chaining / back-swipe from the strip; only horizontal panning starts here. */
  overscroll-behavior-x: contain;
  touch-action: pan-x;
  /* Re-centring rebases scrollLeft itself. */
  overflow-anchor: none;
  scrollbar-width: thin;
}
@media (pointer: coarse) {
  .week-strip__scroller {
    scrollbar-width: none;
  }
  .week-strip__scroller::-webkit-scrollbar {
    display: none;
  }
}

.strip-week {
  flex: 0 0 100%;
  display: flex;
  align-items: stretch;
  gap: 2px;
  min-width: 0;
  /* Room for the focus ring of the first/last pill inside the clipped scroller. */
  padding: var(--space-1) var(--space-0-5) var(--space-1) 0;
  /* The week boundary: a hairline before the week number. */
  border-left: 1px solid var(--border-subtle);
  scroll-snap-align: start;
}
@media (pointer: coarse) {
  .strip-week {
    gap: 0;
  }
}
/* "W42", on the weekday row: the label sits on top of a spacer as tall as the date + dot rows. */
.strip-week__number {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--space-1) calc(var(--lh-15) + 6px);
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-caps);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.day-pill {
  position: relative;
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  min-width: 0;
  height: 51px;
  border-radius: var(--radius-md);
  color: var(--text-primary);
  transition: background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.day-pill:hover {
  background-color: var(--bg-subtle);
}
.day-pill__weekday {
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-medium);
  letter-spacing: var(--tracking-caps);
  color: var(--text-tertiary);
}
.day-pill__date {
  font-size: var(--fs-15);
  line-height: var(--lh-15);
  font-weight: var(--fw-semibold);
}
.day-pill__dot {
  width: 4px;
  height: 4px;
  border-radius: var(--radius-full);
  background-color: transparent;
}
.day-pill__dot.is-visible {
  background-color: var(--text-tertiary);
}
.day-pill.is-today .day-pill__date,
.day-pill.is-today .day-pill__weekday {
  color: var(--accent-text);
  font-weight: var(--fw-semibold);
}
.day-pill.is-selected {
  background-color: var(--accent);
}
.day-pill.is-selected .day-pill__weekday,
.day-pill.is-selected .day-pill__date {
  color: var(--text-on-accent);
}
.day-pill.is-selected .day-pill__dot.is-visible {
  background-color: var(--text-on-accent);
}
.day-pill:focus-visible {
  outline-offset: 0;
}
</style>
