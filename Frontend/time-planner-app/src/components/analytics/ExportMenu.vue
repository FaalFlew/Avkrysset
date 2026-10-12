<script setup lang="ts">
/**
 * ExportMenu — "Export" in the analytics page header.
 *   Signed in: PDF, CSV (rendered by the server for the selected range), Print / Save as PDF.
 *   Guests:    Print / Save as PDF (the only PDF path), CSV (built in the browser).
 *   Paper size (A4 / Letter): defaults to the browser locale's region, override persisted.
 * While a server export runs the trigger becomes "Preparing PDF…" (aria-busy, repeat clicks
 * ignored); after 3 s a "Waking up the server…" hint with Cancel appears. Items are disabled with
 * a visible reason when there is nothing to export.
 * Props:
 *   selection: AnalyticsSelection — the page's current filters (read when an item is chosen)
 *   snapshot: AnalyticsSnapshot | null — the data on screen (guest CSV)
 *   pageState: 'error' | 'loading' | 'first-run' | 'empty' | 'ready'
 *   refetching?: boolean — the data on screen is being replaced
 *   rangeLabel: string — human label of the shown range (CSV metadata)
 */
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { ChevronDown, Download, FileSpreadsheet, FileText, Printer } from "lucide-vue-next";
import { UiButton, UiMenu, type MenuItem } from "@/components/ui";
import { useAuthStore } from "@/stores/authStore";
import { useAnalyticsExport } from "@/composables/useAnalyticsExport";
import { printReport } from "@/composables/usePrintMode";
import type { AnalyticsSnapshot } from "@/composables/useStats";
import { analyticsRange, type AnalyticsSelection } from "@/lib/analyticsBuckets";
import { formatDateTime, formatZoneLabelForRange, now } from "@/lib/datetime";
import { formatLabel } from "@/lib/exportErrors";
import { usePaperPreference, type PaperSize } from "@/lib/paper";

type PageState = "error" | "loading" | "first-run" | "empty" | "ready";

const props = withDefaults(
  defineProps<{
    selection: AnalyticsSelection;
    snapshot: AnalyticsSnapshot | null;
    pageState: PageState;
    refetching?: boolean;
    rangeLabel: string;
  }>(),
  { refetching: false }
);

const { isAuthenticated } = storeToRefs(useAuthStore());
const { paper, setPaper } = usePaperPreference();

const exporter = useAnalyticsExport({
  selection: () => props.selection,
  paper: () => paper.value,
});
const { busy, slow, format } = exporter;

const rootRef = ref<HTMLElement | null>(null);

const NOTHING_TO_EXPORT = "Nothing planned in this range";

/** Why exporting what's on screen (print, guest CSV) is not possible right now, or null. */
const localReason = computed<string | null>(() => {
  if (props.refetching) return "Updating analytics…";
  switch (props.pageState) {
    case "loading":
      return "Analytics are still loading";
    case "error":
      return "Analytics couldn't load";
    case "first-run":
    case "empty":
      return NOTHING_TO_EXPORT;
    default:
      return null;
  }
});

/** Why a server export is not possible right now, or null (the server doesn't need the page data). */
const serverReason = computed<string | null>(() =>
  props.pageState === "error" ? null : localReason.value
);

function exportGuestCsv(): void {
  if (!props.snapshot) return;
  const at = now();
  exporter.downloadGuestCsv(props.snapshot, {
    rangeLabel: props.rangeLabel,
    timeZoneLabel: formatZoneLabelForRange(analyticsRange(props.snapshot.selection)),
    generatedAt: formatDateTime(at),
  });
}

const paperItems = computed<MenuItem[]>(() =>
  (["A4", "Letter"] as PaperSize[]).map((size) => ({
    id: `paper-${size}`,
    label: size,
    ariaLabel: `Paper size ${size}`,
    group: "Paper size",
    checked: paper.value === size,
    keepOpen: true,
    onSelect: () => setPaper(size),
  }))
);

const items = computed<MenuItem[]>(() => {
  const disabled = (reason: string | null) => ({ disabled: !!reason, description: reason ?? undefined });
  const print: MenuItem = {
    id: "print",
    label: "Print / Save as PDF",
    icon: Printer,
    ...disabled(localReason.value),
    onSelect: () => void printReport(),
  };
  if (!isAuthenticated.value) {
    return [
      print,
      { id: "csv", label: "CSV", icon: FileSpreadsheet, ...disabled(localReason.value), onSelect: exportGuestCsv },
      ...paperItems.value,
    ];
  }
  return [
    {
      id: "pdf",
      label: "PDF",
      icon: FileText,
      ...disabled(serverReason.value),
      onSelect: () => void exporter.downloadReport("pdf"),
    },
    {
      id: "csv",
      label: "CSV",
      icon: FileSpreadsheet,
      ...disabled(serverReason.value),
      onSelect: () => void exporter.downloadReport("csv"),
    },
    print,
    ...paperItems.value,
  ];
});

const busyLabel = computed(() => `Preparing ${formatLabel(format.value ?? "pdf")}…`);
const SLOW_HINT = "Waking up the server… this can take up to 20 seconds.";
const liveText = computed(() => (busy.value ? (slow.value ? SLOW_HINT : busyLabel.value) : ""));

/** While busy the trigger must not open the menu (Arrow keys included). */
function triggerBindings(triggerProps: Record<string, unknown>): Record<string, unknown> {
  return busy.value ? { ...triggerProps, onKeydown: undefined } : triggerProps;
}

function onTriggerClick(toggle: () => void): void {
  if (!busy.value) toggle();
}

function cancelExport(): void {
  exporter.cancel();
  rootRef.value?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus({ preventScroll: true });
}
</script>

<template>
  <!-- row-reverse + wrap: the trigger stays right; the slow-server hint sits beside it when there
       is room and wraps BELOW it on narrow screens (it never widens the header). -->
  <div ref="rootRef" class="export-menu" :class="{ 'is-slow': busy && slow }" data-print-hide>
    <p class="sr-only" role="status" aria-live="polite">{{ liveText }}</p>
    <UiMenu :items="items" placement="bottom-end">
      <template #trigger="{ toggle, triggerProps }">
        <UiButton
          variant="secondary"
          class="export-menu__trigger"
          :loading="busy"
          v-bind="triggerBindings(triggerProps)"
          @click="onTriggerClick(toggle)"
        >
          <template #leading><Download :size="16" /></template>
          {{ busy ? busyLabel : "Export" }}
          <template v-if="!busy" #trailing><ChevronDown :size="14" class="export-menu__chevron" /></template>
        </UiButton>
      </template>
    </UiMenu>
    <div v-if="busy && slow" class="export-menu__slow">
      <p class="export-menu__hint">{{ SLOW_HINT }}</p>
      <UiButton variant="ghost" class="export-menu__cancel" aria-label="Cancel export" @click="cancelExport">
        Cancel
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
/*
 * Never wider than the header row: the page header lets this block shrink (TaskAnalytics), and
 * `row-reverse` + `wrap` keep the trigger on the right with the hint + Cancel beside it, or on
 * the next line when they don't fit. The hint text wraps; Cancel never shrinks.
 */
.export-menu {
  display: flex;
  flex-direction: row-reverse;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: var(--space-1) var(--space-2);
  min-width: 0;
  max-width: 100%;
}

.export-menu__slow {
  display: flex;
  flex: 0 1 auto;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-1);
  min-width: 0;
  max-width: 100%;
}

.export-menu__hint {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 34ch;
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-secondary);
  text-align: end;
}

.export-menu__cancel {
  flex-shrink: 0;
}

.export-menu__chevron {
  color: var(--text-tertiary);
}

@media (max-width: 767.98px) {
  .export-menu__cancel {
    min-height: 44px;
  }
}
</style>
