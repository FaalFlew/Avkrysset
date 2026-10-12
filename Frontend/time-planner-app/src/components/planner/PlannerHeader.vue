<script setup lang="ts">
/**
 * PlannerHeader — sticky planner toolbar.
 * Desktop/tablet: [Today] [‹] [›]  <h1>October 2026 ▾</h1>  W40 ··· (≥1024) 🌐 UTC+02:00 · Europe/Oslo
 * Mobile: one 52px row — month button on the left, "Today" on the right.
 * The month button opens the week picker (CalendarDatePicker: week numbers + year grid) in a
 * popover (a bottom sheet on phones); `D`
 * opens it via the exposed openPicker().
 */
import { computed, nextTick, ref } from "vue";
import { ChevronDown, ChevronLeft, ChevronRight, Globe } from "lucide-vue-next";
import UiButton from "@/components/ui/UiButton.vue";
import UiIconButton from "@/components/ui/UiIconButton.vue";
import UiBadge from "@/components/ui/UiBadge.vue";
import UiPopover from "@/components/ui/UiPopover.vue";
import UiTooltip from "@/components/ui/UiTooltip.vue";
import CalendarDatePicker from "@/components/CalendarDatePicker.vue";
import { formatPlannerTitle, formatWeekBadge, formatWeekLong } from "@/lib/plannerFormat";
import { formatTimeZoneLabel, getActiveTimeZone, type DateKey } from "@/lib/datetime";
import { useNow } from "@/composables/useClock";

const props = defineProps<{
  /** Visible days (7 on ≥ 768px, 1 on phones). */
  days: readonly DateKey[];
  /** The week of the selected day (for the title on phones). */
  week: readonly DateKey[];
  mobile: boolean;
  /** Show the time-zone label (≥ 1024px). */
  showTimeZone: boolean;
}>();

const emit = defineEmits<{ today: []; prev: []; next: [] }>();

const pickerOpen = ref(false);
const picker = ref<InstanceType<typeof CalendarDatePicker> | null>(null);
const now = useNow();

// Phones show one day: its month ("October 2026"); otherwise the months the visible week spans.
const title = computed(() => formatPlannerTitle(props.days));
const weekBadge = computed(() => formatWeekBadge(props.days[0] ?? props.week[0]!));
const weekLong = computed(() => formatWeekLong(props.days[0] ?? props.week[0]!));
const tzLabel = computed(() => formatTimeZoneLabel(now.value));
const tzHint = computed(() => `Times are shown in your device's time zone (${getActiveTimeZone()}).`);
const prevLabel = computed(() => (props.mobile ? "Previous day" : "Previous week"));
const nextLabel = computed(() => (props.mobile ? "Next day" : "Next week"));

function onPick(): void {
  pickerOpen.value = false;
}

async function openPicker(): Promise<void> {
  pickerOpen.value = true;
  await nextTick();
  await picker.value?.focusGrid();
}

defineExpose({ openPicker });
</script>

<template>
  <header class="planner-header" :class="{ 'planner-header--mobile': mobile }">
    <template v-if="!mobile">
      <div class="planner-header__left">
        <UiTooltip text="Go to today" :shortcut="['T']" placement="bottom">
          <UiButton size="sm" variant="secondary" aria-keyshortcuts="t" @click="emit('today')">Today</UiButton>
        </UiTooltip>
        <div class="planner-header__arrows">
          <UiIconButton :label="prevLabel" :shortcut="['K']" tooltip-placement="bottom" @click="emit('prev')">
            <ChevronLeft :size="16" />
          </UiIconButton>
          <UiIconButton :label="nextLabel" :shortcut="['J']" tooltip-placement="bottom" @click="emit('next')">
            <ChevronRight :size="16" />
          </UiIconButton>
        </div>
        <h1 class="planner-header__title" tabindex="-1" data-page-heading>
          <UiPopover v-model:open="pickerOpen" ariaLabel="Choose a week" placement="bottom-start">
            <template #trigger="{ toggle, triggerProps }">
              <button
                type="button"
                class="month-button"
                v-bind="triggerProps"
                aria-keyshortcuts="d"
                @click="toggle"
              >
                <span class="month-button__label">{{ title }}</span>
                <ChevronDown :size="16" class="month-button__chevron" />
                <span class="sr-only">, {{ weekLong }}. Choose a week</span>
              </button>
            </template>
            <CalendarDatePicker ref="picker" autofocus @select="onPick" />
          </UiPopover>
        </h1>
        <UiBadge class="planner-header__week" aria-hidden="true">{{ weekBadge }}</UiBadge>
      </div>
      <div v-if="showTimeZone" class="planner-header__right">
        <UiTooltip :text="tzHint" placement="bottom">
          <span class="tz-label" tabindex="0">
            <Globe :size="14" />
            <span>{{ tzLabel }}</span>
          </span>
        </UiTooltip>
      </div>
    </template>

    <template v-else>
      <h1 class="planner-header__title planner-header__title--mobile" tabindex="-1" data-page-heading>
        <UiPopover v-model:open="pickerOpen" ariaLabel="Choose a week">
          <template #trigger="{ toggle, triggerProps }">
            <button type="button" class="month-button month-button--mobile" v-bind="triggerProps" @click="toggle">
              <span class="month-button__label">{{ title }}</span>
              <ChevronDown :size="16" class="month-button__chevron" />
              <span class="sr-only">, {{ weekLong }}. Choose a week</span>
            </button>
          </template>
          <CalendarDatePicker ref="picker" autofocus @select="onPick" />
        </UiPopover>
      </h1>
      <UiButton size="sm" variant="secondary" @click="emit('today')">Today</UiButton>
    </template>
  </header>
</template>

<style scoped>
.planner-header {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  height: var(--header-h);
  padding: 0 var(--space-6);
  border-bottom: 1px solid var(--border-subtle);
  background-color: var(--bg-app);
  flex-shrink: 0;
}
.planner-header--mobile {
  height: 52px;
  padding: 0 var(--space-3) 0 var(--space-1);
  gap: var(--space-2);
}
@media (min-width: 768px) and (max-width: 1023.98px) {
  .planner-header {
    padding: 0 var(--space-4);
  }
}

.planner-header__left {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.planner-header__arrows {
  display: flex;
  gap: 2px;
}
.planner-header__title {
  min-width: 0;
  margin: 0;
  outline: none;
  font-size: var(--fs-20);
  line-height: var(--lh-20);
}
.planner-header__title--mobile {
  font-size: var(--fs-17);
  line-height: var(--lh-17);
}
.planner-header__week {
  flex-shrink: 0;
}

.month-button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  height: var(--control-h-md);
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: inherit;
  line-height: inherit;
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  white-space: nowrap;
  transition: background-color var(--dur-fast) var(--ease-standard);
}
.month-button:hover,
.month-button[aria-expanded="true"] {
  background-color: var(--bg-subtle);
}
.month-button__label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.month-button__chevron {
  color: var(--text-tertiary);
}

.planner-header__right {
  display: flex;
  align-items: center;
  min-width: 0;
}
.tz-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: var(--space-1) var(--space-1-5);
  border-radius: var(--radius-sm);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
  white-space: nowrap;
}
</style>
