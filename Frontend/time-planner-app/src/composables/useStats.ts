// src/composables/useStats.ts
//
// Analytics data for the /analytics page. Both modes produce the same view model
// (AnalyticsSnapshot) for the selected range:
// - guest: computed locally from the tasks in localStorage;
// - authenticated: fetched from /tasks/analytics for the same half-open instant range and
//   mapped onto the same zero-filled period buckets (see src/lib/analyticsBuckets.ts).
// Presentation (labels, colors, chart options) lives in src/components/analytics/*.

import { computed, ref, watch, onMounted, type ComputedRef, type Ref } from "vue";
import { useTaskStore } from "@/stores/taskStore";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/authStore";
import type { Task, TaskAnalyticsResponse } from "@/types";
import { apiDataService } from "@/services/apiDataService";
import { isSessionChangedError } from "@/lib/apiErrors";
import { dateKeyParts, isInRange, isoWeekOf, toDateKey, todayKey } from "@/lib/datetime";
import { useTimeZone } from "@/composables/useClock";
import {
  analyticsBuckets,
  analyticsRange,
  bucketKeyOf,
  densifyBreakdown,
  isoWeekYearsOfCalendarYears,
  yearsOfInstants,
  type AnalyticsSelection,
  type AnalyticsView,
} from "@/lib/analyticsBuckets";
import { fullBucketLabel, shortBucketLabel } from "@/components/analytics/format";
import { compareByHoursThenName } from "@/lib/analyticsOrder";

export type { AnalyticsSelection, AnalyticsView };

/** Hours spent in one category. `color` is the category's hex, or null when unknown. */
export interface CategoryHours {
  id: string;
  name: string;
  color: string | null;
  hours: number;
}

/** One bar of the "Hours by period" chart. */
export interface PeriodBar {
  key: string;
  /** Axis label: "Jan", "W14", "Mon 5". */
  label: string;
  /** Tooltip/table label: "March 2026", "Week 14 · Mar 30 – Apr 5, 2026", "Mon, Oct 5". */
  fullLabel: string;
  hours: number;
  /** Categories in this period, largest first. Only known for guest data (null otherwise). */
  categories: CategoryHours[] | null;
  /** Name of the category with the most hours in this period, when known. */
  topCategory: string | null;
}

/** A category's share of the selected range. */
export interface CategorySlice extends CategoryHours {
  /** 0–1 share of the range's total hours. */
  share: number;
}

/** A template's time in the selected range. */
export interface TemplateRow {
  id: string;
  name: string;
  color: string | null;
  hours: number;
  share: number;
  /** The template no longer exists (tasks keep their link to it). */
  deleted: boolean;
  /** Name of the template's category, when known (guest data; null for deleted templates). */
  categoryName: string | null;
}

export interface AnalyticsSnapshot {
  /** The selection this data belongs to (may lag the filters while a refetch is running). */
  selection: AnalyticsSelection;
  /** Every period of the selected range, in order, zero-filled. */
  periods: PeriodBar[];
  /** The server breakdown could not be mapped onto periods; `periods` is the raw (sparse) list. */
  sparse: boolean;
  /** Largest first. */
  categories: CategorySlice[];
  /** Largest first. */
  templates: TemplateRow[];
  /** Hours of tasks without a template. */
  untemplatedHours: number;
  totalHours: number;
  /** Tasks starting in the range; known for guest data only (null otherwise). */
  taskCount: number | null;
  /** Distinct local dates with a task starting on them; guest data only (null otherwise). */
  activeDays: number | null;
}

export interface StatsFilters {
  /** Calendar year for "monthly"; ISO week-year for "weekly" and "daily". */
  year: Ref<number>;
  view: Ref<AnalyticsView>;
  /** 0-based months, inclusive. */
  monthRange: Ref<{ start: number; end: number }>;
  /** ISO week numbers, inclusive. */
  weekRange: Ref<{ start: number; end: number }>;
  /** ISO week shown by the daily view. */
  dailyWeek: Ref<number>;
}

export interface FilteredStats {
  /** Data for the current (or, while refetching, the previous) selection; null before the first load. */
  snapshot: ComputedRef<AnalyticsSnapshot | null>;
  /** First load in progress (nothing to show yet). */
  isLoading: ComputedRef<boolean>;
  /** A refetch is running while previous data is on screen. */
  isRefetching: ComputedRef<boolean>;
  /** Message of the last failed request, or null. */
  error: Readonly<Ref<string | null>>;
  /** Re-run the request for the current selection (no-op for guests). */
  refetch: () => Promise<void>;
  totalHours: ComputedRef<number>;
  /**
   * Whether the user has any tasks at all (first-run detection). Known for guests; the API has
   * no cheap way to tell, so authenticated users are assumed to have data.
   */
  hasAnyData: ComputedRef<boolean>;
}

const currentYear = () => dateKeyParts(todayKey()).year;
const currentIsoYear = () => isoWeekOf(todayKey()).isoYear;

function selectionOf(filters: StatsFilters): AnalyticsSelection {
  return {
    view: filters.view.value,
    year: filters.year.value,
    monthRange: { ...filters.monthRange.value },
    weekRange: { ...filters.weekRange.value },
    dailyWeek: filters.dailyWeek.value,
  };
}

/** Hours DESC, then name, then id (ordinal) — the order shared with the server. */
const byHoursDesc = compareByHoursThenName;
const share = (hours: number, total: number) => (total > 0 ? hours / total : 0);

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Request failed";
}

export function useStats() {
  const store = useTaskStore();
  const { tasks, templates } = storeToRefs(store);
  const authStore = useAuthStore();

  // Guests: on a hard refresh of /analytics this page can mount before App.vue loads local
  // data. Load it now so the first render is not a false "no data" state.
  if (!authStore.isAuthenticated && !store.guestDataLoaded) store.loadGuestData();

  // Buckets follow the device's calendar: recompute (guests) or refetch (API) when it changes.
  const { timeZone } = useTimeZone();

  // Years that have tasks, for the year selector: calendar years for the Month view and ISO
  // week-years for the Week/Day views (2024-12-30 is in 2025-W01). Newest first.
  const availableYears = ref<number[]>([currentYear()]);
  const availableIsoYears = ref<number[]>([currentIsoYear()]);

  async function loadYears(): Promise<void> {
    // AUTHENTICATED: the server lists calendar years (in the X-Time-Zone calendar).
    try {
      const years = await apiDataService.getTaskYears();
      availableYears.value = years.length > 0 ? years : [currentYear()];
    } catch (error) {
      if (isSessionChangedError(error)) return; // logged out meanwhile
      console.error("Failed to fetch available years:", error);
      availableYears.value = [currentYear()];
    }
    availableIsoYears.value = isoWeekYearsOfCalendarYears(availableYears.value);
  }

  onMounted(() => {
    if (authStore.isAuthenticated) loadYears();
  });

  watch(
    [tasks, timeZone],
    ([newTasks]) => {
      if (authStore.isAuthenticated || newTasks.length === 0) return;
      // GUEST: exact years of the local tasks.
      const years = yearsOfInstants(newTasks.map((task) => task.start));
      availableYears.value = years.calendarYears;
      availableIsoYears.value = years.isoYears;
    },
    { deep: true, immediate: true }
  );

  watch(timeZone, () => {
    if (authStore.isAuthenticated) loadYears();
  });

  const categoryInfo = (id: string, task?: Task): Omit<CategoryHours, "hours"> => {
    const category = store.getCategoryById(id);
    return {
      id,
      name: category?.name ?? task?.categoryName ?? "Unknown category",
      color: category?.color ?? task?.categoryColor ?? null,
    };
  };

  // --- Guest: everything from local tasks ---------------------------------------------------
  function guestSnapshot(sel: AnalyticsSelection): AnalyticsSnapshot {
    const range = analyticsRange(sel);
    const inRange = tasks.value.filter((task) => isInRange(task.start, range));
    const buckets = analyticsBuckets(sel);

    const perBucket = new Map<string, Map<string, number>>(buckets.map((b) => [b.key, new Map()]));
    const perCategory = new Map<string, { hours: number; sample: Task }>();
    const perTemplate = new Map<string, { hours: number; sample: Task }>();
    const activeDates = new Set<string>();
    let totalHours = 0;
    let templatedHours = 0;

    for (const task of inRange) {
      const hours = Number(task.duration) || 0;
      totalHours += hours;
      activeDates.add(toDateKey(task.start));

      const bucket = perBucket.get(bucketKeyOf(sel.view, task.start));
      if (bucket) bucket.set(task.categoryId, (bucket.get(task.categoryId) ?? 0) + hours);

      const cat = perCategory.get(task.categoryId);
      if (cat) cat.hours += hours;
      else perCategory.set(task.categoryId, { hours, sample: task });

      if (task.templateId) {
        templatedHours += hours;
        const tpl = perTemplate.get(task.templateId);
        if (tpl) tpl.hours += hours;
        else perTemplate.set(task.templateId, { hours, sample: task });
      }
    }

    const periods: PeriodBar[] = buckets.map((b) => {
      const totals = perBucket.get(b.key)!;
      const categories = [...totals.entries()]
        .map(([id, hours]) => ({ ...categoryInfo(id), hours }))
        .sort(byHoursDesc);
      return {
        key: b.key,
        label: shortBucketLabel(sel.view, b.key),
        fullLabel: fullBucketLabel(sel.view, b.key),
        hours: categories.reduce((sum, c) => sum + c.hours, 0),
        categories,
        topCategory: categories[0]?.name ?? null,
      };
    });

    const categories: CategorySlice[] = [...perCategory.entries()]
      .map(([id, { hours, sample }]) => ({
        ...categoryInfo(id, sample),
        hours,
        share: share(hours, totalHours),
      }))
      .sort(byHoursDesc);

    const templateRows: TemplateRow[] = [...perTemplate.entries()]
      .map(([id, { hours, sample }]) => {
        const template = templates.value.find((t) => t.id === id);
        const category = template
          ? store.getCategoryById(template.categoryId)
          : categoryInfo(sample.categoryId, sample);
        const color = template
          ? (category?.color ?? template.categoryColor ?? null)
          : (category?.color ?? null);
        return {
          id,
          name: template?.title ?? "Deleted template",
          color,
          hours,
          share: share(hours, totalHours),
          deleted: !template,
          // Like the server: a deleted template has no category in the breakdown.
          categoryName: template ? (category?.name ?? template.categoryName ?? null) : null,
        };
      })
      .sort(byHoursDesc);

    return {
      selection: sel,
      periods,
      sparse: false,
      categories,
      templates: templateRows,
      untemplatedHours: Math.max(0, totalHours - templatedHours),
      totalHours,
      taskCount: inRange.length,
      activeDays: activeDates.size,
    };
  }

  // --- Authenticated: map the API response onto the same model -----------------------------
  function apiSnapshot(sel: AnalyticsSelection, data: TaskAnalyticsResponse): AnalyticsSnapshot {
    const timePerCategory = Array.isArray(data.timePerCategory) ? data.timePerCategory : [];
    const timePerTemplate = Array.isArray(data.timePerTemplate) ? data.timePerTemplate : [];
    const breakdown = Array.isArray(data.breakdownData) ? data.breakdownData : [];
    const totalHours = Number.isFinite(data.totalHours)
      ? data.totalHours
      : timePerCategory.reduce((sum, c) => sum + (c.totalHours || 0), 0);

    // The API names only the dominant category's color per period; name it when unambiguous.
    const topCategoryByColor = (color: string | undefined): string | null => {
      if (!color) return null;
      const matches = timePerCategory.filter(
        (c) => c.categoryColor?.toLowerCase() === color.toLowerCase()
      );
      return matches.length === 1 ? matches[0]!.categoryName : null;
    };

    const dense = densifyBreakdown(sel, breakdown, "");
    const periods: PeriodBar[] = dense
      ? dense.map((bar) => ({
          key: bar.key,
          label: shortBucketLabel(sel.view, bar.key),
          fullLabel: fullBucketLabel(sel.view, bar.key),
          hours: bar.value,
          categories: null,
          topCategory: bar.value > 0 ? topCategoryByColor(bar.color) : null,
        }))
      : breakdown.map((d) => ({
          key: d.key ?? d.label,
          label: d.key ? shortBucketLabel(sel.view, d.key) : d.label,
          fullLabel: d.key ? fullBucketLabel(sel.view, d.key) : d.label,
          hours: d.value,
          categories: null,
          topCategory: topCategoryByColor(d.dominantCategoryColor),
        }));

    const categories: CategorySlice[] = timePerCategory
      .map((c) => ({
        id: c.categoryId,
        name: c.categoryName || "Unknown category",
        color: c.categoryColor || null,
        hours: c.totalHours,
        share: share(c.totalHours, totalHours),
      }))
      .sort(byHoursDesc);

    const templateRows: TemplateRow[] = timePerTemplate
      .map((t, index) => ({
        id: t.templateId ?? `deleted-${index}`,
        name: t.templateTitle || "Deleted template",
        color: t.categoryColor || null,
        hours: t.totalHours,
        share: share(t.totalHours, totalHours),
        deleted: !t.templateTitle,
        categoryName: null,
      }))
      .sort(byHoursDesc);
    const templatedHours = templateRows.reduce((sum, t) => sum + t.hours, 0);

    return {
      selection: sel,
      periods,
      sparse: !dense,
      categories,
      templates: templateRows,
      untemplatedHours: Math.max(0, totalHours - templatedHours),
      totalHours,
      taskCount: null,
      activeDays: null,
    };
  }

  // Main composable function to generate reactive stats based on filters.
  const useFilteredStats = (filters: StatsFilters): FilteredStats => {
    const selection = computed(() => selectionOf(filters));

    if (!authStore.isAuthenticated) {
      const snapshot = computed(() => {
        void timeZone.value; // re-bucket in the new zone's calendar after a zone change
        return guestSnapshot(selection.value);
      });
      return {
        snapshot,
        isLoading: computed(() => false),
        isRefetching: computed(() => false),
        error: ref(null),
        refetch: async () => {},
        totalHours: computed(() => snapshot.value.totalHours),
        hasAnyData: computed(() => tasks.value.length > 0),
      };
    }

    const response = ref<TaskAnalyticsResponse | null>(null);
    // The selection the current response was fetched for.
    const loadedSelection = ref<AnalyticsSelection>(selection.value);
    const pending = ref(0);
    const error = ref<string | null>(null);
    let latestRequest = 0;

    async function load(sel: AnalyticsSelection): Promise<void> {
      const requestId = ++latestRequest;
      pending.value++;
      try {
        // Half-open instant range of the selected local months/weeks.
        const data = await apiDataService.getTaskAnalytics(analyticsRange(sel), sel.view);
        if (requestId !== latestRequest) return; // a newer selection superseded this one
        response.value = data;
        loadedSelection.value = sel;
        error.value = null;
      } catch (e) {
        if (requestId !== latestRequest || isSessionChangedError(e)) return; // superseded / logged out
        console.error("Failed to fetch analytics", e);
        error.value = errorMessage(e);
      } finally {
        pending.value--;
      }
    }

    watch(selection, (sel) => load(sel), { immediate: true, deep: true });
    // The server buckets by the X-Time-Zone header, so a zone change needs fresh data.
    watch(timeZone, () => load(selection.value));

    const snapshot = computed(() =>
      response.value ? apiSnapshot(loadedSelection.value, response.value) : null
    );

    return {
      snapshot,
      isLoading: computed(() => pending.value > 0 && !response.value),
      isRefetching: computed(() => pending.value > 0 && !!response.value),
      error,
      refetch: () => load(selection.value),
      totalHours: computed(() => snapshot.value?.totalHours ?? 0),
      hasAnyData: computed(() => true),
    };
  };

  return { availableYears, availableIsoYears, useFilteredStats };
}
