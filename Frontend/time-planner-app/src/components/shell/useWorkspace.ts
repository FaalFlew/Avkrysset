// src/components/shell/useWorkspace.ts — the current workspace (Personal or an organization),
// read from the URL, and its navigation.

import { computed } from "vue";
import { useRoute } from "vue-router";
import { useOrgStore } from "@/stores/orgStore";
import { contextFromParams, navItemsFor, PRIMARY_COUNT } from "./navItems";

export function useWorkspace() {
  const route = useRoute();
  const orgStore = useOrgStore();

  const context = computed(() => contextFromParams(route.params));
  const orgId = computed(() => (context.value.kind === "org" ? context.value.orgId : null));
  /** The current org, once loaded (undefined in Personal or while OrgLayout checks the membership). */
  const org = computed(() => orgStore.orgById(orgId.value));
  const navItems = computed(() => navItemsFor(context.value));
  /** Tab bar items and the 1–4 hotkeys. */
  const primaryItems = computed(() => navItems.value.slice(0, PRIMARY_COUNT));
  /** Items that only fit in the phone More sheet. */
  const overflowItems = computed(() => navItems.value.slice(PRIMARY_COUNT));

  return { context, orgId, org, navItems, primaryItems, overflowItems };
}
