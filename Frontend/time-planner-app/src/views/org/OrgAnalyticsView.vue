<script setup lang="ts">
/**
 * OrgAnalyticsView — the organization's analytics page. Placeholder: 3E (analytics) fills it.
 * Rendered inside OrgLayout, so the membership is already confirmed; the org and my role come from
 * useWorkspace() / useOrgPermissions().
 */
import { ChartColumn } from "lucide-vue-next";
import UiPageHeader from "@/components/ui/UiPageHeader.vue";
import UiEmptyState from "@/components/ui/UiEmptyState.vue";
import { useWorkspace } from "@/components/shell/useWorkspace";

const { org } = useWorkspace();
</script>

<template>
  <div class="org-page">
    <UiPageHeader title="Analytics" :subtitle="org?.name" />
    <UiEmptyState :icon="ChartColumn" title="Coming soon" description="Hours by member, category and period, in the organization's time zone." />
  </div>
</template>

<style scoped>
.org-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: var(--content-medium);
  margin: 0 auto;
  padding: var(--space-8) var(--space-6) var(--space-12);
}
@media (max-width: 767.98px) {
  .org-page {
    padding: var(--space-5) var(--space-4) var(--space-10);
  }
}
</style>
