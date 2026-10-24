<script setup lang="ts">
/**
 * OrgLayout — parent of every /orgs/:orgId/… page. Checks the membership (orgStore, cached list
 * first) instead of the router guard, so a cold server never freezes navigation:
 *   checking → skeleton (+ the slow-server hint after 3 s)
 *   active   → <RouterView :key="orgId"> (each org gets fresh page state)
 *   missing  → toast "You're not a member of that organization" + replace('/orgs')
 *   error    → UiErrorState with Retry
 * A membership that ends while a page is open (a re-check after a 403) leaves the same way.
 * Owns the document title on org pages: "{page} · {org} · Time Planner".
 */
import { computed, onBeforeUnmount, ref, watch, watchEffect } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import UiErrorState from "@/components/ui/UiErrorState.vue";
import UiSkeleton from "@/components/ui/UiSkeleton.vue";
import { onMembershipLost, useOrgStore } from "@/stores/orgStore";
import { useUIStore } from "@/stores/uiStore";
import { decideOrgAccess, NOT_A_MEMBER_MESSAGE, ORGS_PATH, orgDocumentTitle } from "@/lib/orgAccess";

const SLOW_HINT_DELAY_MS = 3000;

const route = useRoute();
const router = useRouter();
const orgStore = useOrgStore();
const uiStore = useUIStore();

const orgId = computed(() => {
  const raw = route.params.orgId;
  return String(Array.isArray(raw) ? raw[0] : (raw ?? ""));
});
const org = computed(() => orgStore.orgById(orgId.value));

/** A cached membership renders at once (no skeleton flash). */
const state = ref<"checking" | "active" | "error">(org.value?.myRole ? "active" : "checking");
const retrying = ref(false);
const showSlowHint = ref(false);
let slowTimer: number | undefined;
let checkSeq = 0;

function stopSlowHint(): void {
  if (slowTimer !== undefined) window.clearTimeout(slowTimer);
  slowTimer = undefined;
  showSlowHint.value = false;
}

function leave(message: string): void {
  uiStore.showToast(message, "error");
  void router.replace(ORGS_PATH).catch(() => undefined);
}

async function check(): Promise<void> {
  const seq = ++checkSeq;
  const id = orgId.value;
  if (!id) return;
  stopSlowHint();
  if (orgStore.orgById(id)?.myRole) {
    state.value = "active";
    retrying.value = false;
    return;
  }
  // While retrying, the error state stays (its button shows the progress).
  if (state.value !== "error") state.value = "checking";
  slowTimer = window.setTimeout(() => {
    showSlowHint.value = true;
  }, SLOW_HINT_DELAY_MS);

  const result = await orgStore.ensureMembership(id);
  if (seq !== checkSeq) return; // another org (or a retry) took over
  stopSlowHint();
  retrying.value = false;
  const decision = decideOrgAccess(result);
  if (decision.kind === "render") state.value = "active";
  else if (decision.kind === "error") state.value = "error";
  else leave(decision.message);
}

function retry(): void {
  retrying.value = true;
  void check();
}

watch(orgId, () => void check(), { immediate: true });

const stopLostListener = onMembershipLost((lostId) => {
  if (state.value !== "active" || lostId.toLowerCase() !== orgId.value.toLowerCase()) return;
  checkSeq += 1;
  leave(NOT_A_MEMBER_MESSAGE);
});

onBeforeUnmount(() => {
  checkSeq += 1;
  stopSlowHint();
  stopLostListener();
});

watchEffect(() => {
  if (!route.params.orgId) return;
  document.title = orgDocumentTitle(route.meta.title, org.value?.name);
});
</script>

<template>
  <RouterView v-if="state === 'active'" :key="orgId" />

  <div v-else-if="state === 'error'" class="org-layout__state">
    <UiErrorState
      title="Couldn't open this organization"
      description="Check your connection and try again. If the server was asleep, it can take a few seconds to wake up."
      :retrying="retrying"
      @retry="retry"
    />
  </div>

  <div v-else class="org-layout__state" aria-busy="true">
    <span class="sr-only" role="status">Loading organization…</span>
    <div class="org-layout__skeleton">
      <UiSkeleton width="40%" :height="24" />
      <UiSkeleton width="65%" :height="14" />
      <UiSkeleton :height="160" radius="var(--radius-lg)" />
    </div>
    <p class="org-layout__hint" aria-live="polite">
      <template v-if="showSlowHint">The server may be waking up — this can take up to 20 seconds.</template>
    </p>
  </div>
</template>

<style scoped>
.org-layout__state {
  width: 100%;
  max-width: var(--content-medium);
  margin: 0 auto;
  padding: var(--space-8) var(--space-6) var(--space-12);
}
@media (max-width: 767.98px) {
  .org-layout__state {
    padding: var(--space-5) var(--space-4) var(--space-10);
  }
}
.org-layout__skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.org-layout__hint {
  min-height: var(--lh-13);
  margin-top: var(--space-4);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
</style>
