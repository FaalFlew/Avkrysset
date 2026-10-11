<script setup lang="ts">
/**
 * PrintReportHeader — the header of the printed analytics report (hidden on screen):
 * logo, "Analytics report", the range, the time zone and when it was generated (the moment
 * print mode was entered, see usePrintMode).
 * Props:
 *   rangeLabel: string — e.g. "Weeks 1–53 · Dec 29, 2025 – Jan 3, 2027"
 */
import { computed } from "vue";
import { AppLogo } from "@/components/ui";
import { formatDateTime, formatTimeZoneLabel } from "@/lib/datetime";
import { printState } from "@/composables/usePrintMode";

defineProps<{ rangeLabel: string }>();

const generatedAt = computed(() => formatDateTime(printState.printedAt));
const zoneLabel = computed(() => formatTimeZoneLabel(printState.printedAt));
</script>

<template>
  <header class="print-report-header print-only">
    <div class="print-report-header__brand">
      <AppLogo :size="20" with-wordmark />
    </div>
    <p class="print-report-header__title">Analytics report</p>
    <p class="print-report-header__range">{{ rangeLabel }}</p>
    <dl class="print-report-header__meta">
      <div>
        <dt>Time zone</dt>
        <dd>{{ zoneLabel }}</dd>
      </div>
      <div>
        <dt>Generated</dt>
        <dd>{{ generatedAt }}</dd>
      </div>
    </dl>
  </header>
</template>

<style scoped>
.print-report-header {
  flex-direction: column;
  gap: var(--space-1);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-default);
}

.print-report-header__brand {
  margin-bottom: var(--space-2);
}

.print-report-header__title {
  font-size: var(--fs-20);
  line-height: var(--lh-20);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--text-primary);
}

.print-report-header__range {
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  color: var(--text-primary);
}

.print-report-header__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-6);
  margin: var(--space-1) 0 0;
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-secondary);
}
.print-report-header__meta div {
  display: flex;
  gap: var(--space-1);
}
.print-report-header__meta dt {
  font-weight: var(--fw-medium);
}
.print-report-header__meta dt::after {
  content: ":";
}

@media print {
  .print-report-header {
    display: flex;
  }
}
</style>
