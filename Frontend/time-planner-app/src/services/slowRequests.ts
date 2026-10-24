// src/services/slowRequests.ts — "is a change waiting for a cold server?" for the non-blocking
// "Waking up the server…" indicator (components/ServerWakeIndicator.vue).
//
// apiService starts a tracker for every create/update/delete of the signed-in session and stops
// it when the request settles for good (after a token refresh + retry, an abort on logout, …).
// A mutation counts as slow once it has been running for SLOW_MUTATION_MS.

import { computed, ref } from "vue";

/** When a pending create/update/delete starts showing the "Waking up the server…" hint. */
export const SLOW_MUTATION_MS = 3_000;

const slowMutations = ref(0);

/** True while at least one mutation has been running for longer than SLOW_MUTATION_MS. */
export const isMutationSlow = computed(() => slowMutations.value > 0);

/** Start tracking one mutation. Returns its idempotent `done()`. */
export function trackMutation(): () => void {
  let slow = false;
  let done = false;
  const timer = setTimeout(() => {
    if (done) return;
    slow = true;
    slowMutations.value += 1;
  }, SLOW_MUTATION_MS);
  return () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (slow) slowMutations.value = Math.max(0, slowMutations.value - 1);
  };
}

/** Test hook: forget every tracked mutation. */
export function resetSlowMutations(): void {
  slowMutations.value = 0;
}
