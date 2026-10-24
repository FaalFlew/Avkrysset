<script lang="ts">
export { meetsPasswordRules, PASSWORD_RULES } from "./passwordRules";
</script>

<script setup lang="ts">
/**
 * PasswordRequirements — live checklist of the backend password rules.
 * Props:
 *   password: string
 *   id?: string — id of the list (point the password input's aria-describedby at it)
 * Rows show CircleCheck (success) when met, Circle (tertiary) otherwise, plus sr-only state.
 * A debounced polite live region announces "x of 5 requirements met".
 * Also exported from this module (and from ./passwordRules): meetsPasswordRules(pw), PASSWORD_RULES.
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Circle, CircleCheck } from "lucide-vue-next";
import { PASSWORD_RULES as RULES } from "./passwordRules";

const props = withDefaults(defineProps<{ password: string; id?: string }>(), { id: undefined });

const results = computed(() => RULES.map((rule) => ({ id: rule.id, label: rule.label, met: rule.test(props.password) })));
const metCount = computed(() => results.value.filter((r) => r.met).length);

const summary = ref("");
let timer: number | undefined;
watch(metCount, (count) => {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    summary.value =
      count === RULES.length
        ? "All password requirements met."
        : `${count} of ${RULES.length} password requirements met.`;
  }, 700);
});
onBeforeUnmount(() => {
  if (timer !== undefined) window.clearTimeout(timer);
});
</script>

<template>
  <div class="pw-reqs">
    <ul :id="id" class="pw-reqs__list" role="list" aria-label="Password requirements">
      <li v-for="rule in results" :key="rule.id" class="pw-reqs__item" :class="{ 'is-met': rule.met }">
        <CircleCheck v-if="rule.met" class="pw-reqs__icon" :size="14" />
        <Circle v-else class="pw-reqs__icon" :size="14" />
        <span>{{ rule.label }}</span>
        <span class="sr-only">{{ rule.met ? "(met)" : "(not met)" }}</span>
      </li>
    </ul>
    <p class="sr-only" aria-live="polite">{{ summary }}</p>
  </div>
</template>

<style scoped>
.pw-reqs__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-1) var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.pw-reqs__item {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
  transition: color var(--dur-fast) var(--ease-standard);
}
.pw-reqs__item.is-met {
  color: var(--text-secondary);
}
.pw-reqs__item.is-met .pw-reqs__icon {
  color: var(--success-text);
}
</style>
