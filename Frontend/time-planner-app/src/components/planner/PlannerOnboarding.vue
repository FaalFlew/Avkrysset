<script setup lang="ts">
/**
 * PlannerOnboarding — first-run card (floating top-right of the grid on desktop, inline above the
 * grid on phones). Dismissal is remembered in localStorage "tp-onboarding-dismissed".
 * On phones the card is compact: a one-line summary with "Show tips" to expand the steps, so it
 * does not push the day grid off screen.
 */
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { ChevronDown, X } from "lucide-vue-next";
import UiButton from "@/components/ui/UiButton.vue";
import UiIconButton from "@/components/ui/UiIconButton.vue";

withDefaults(defineProps<{ mobile?: boolean; guest?: boolean; floating?: boolean }>(), {
  mobile: false,
  guest: false,
  floating: false,
});
const emit = defineEmits<{ dismiss: [] }>();

const expanded = ref(false);
</script>

<template>
  <section
    class="onboarding"
    :class="{ 'onboarding--floating': floating, 'onboarding--compact': mobile }"
    aria-labelledby="onboarding-title"
  >
    <div class="onboarding__head">
      <h2 id="onboarding-title" class="onboarding__title">Plan your week in a few clicks</h2>
      <UiIconButton label="Dismiss" size="sm" :tooltip="false" @click="emit('dismiss')">
        <X :size="16" />
      </UiIconButton>
    </div>

    <template v-if="mobile">
      <p class="onboarding__summary">Tap a time to add a task. Press and hold a task to move it.</p>
      <div v-if="expanded" id="onboarding-tips" class="onboarding__more">
        <p class="onboarding__summary">Swipe left or right to change day.</p>
        <p class="onboarding__summary">
          Save tasks you repeat as templates and add them in one click.
          <RouterLink to="/templates">Create a template</RouterLink>
        </p>
        <p v-if="guest" class="onboarding__guest">
          You're in guest mode — everything is saved in this browser. Create a free account to sync across devices.
        </p>
      </div>
      <div class="onboarding__actions">
        <UiButton size="sm" variant="secondary" @click="emit('dismiss')">Got it</UiButton>
        <UiButton
          size="sm"
          variant="ghost"
          :aria-expanded="expanded"
          aria-controls="onboarding-tips"
          @click="expanded = !expanded"
        >
          {{ expanded ? "Fewer tips" : "More tips" }}
          <template #trailing>
            <ChevronDown :size="14" class="onboarding__chevron" :class="{ 'is-open': expanded }" />
          </template>
        </UiButton>
      </div>
    </template>

    <template v-else>
      <ol class="onboarding__steps">
        <li>Click or drag on the calendar to add a task.</li>
        <li>Drag a task to move it, or drag its edges to change its length.</li>
        <li>Save tasks you repeat as templates and add them in one click.</li>
      </ol>
      <p v-if="guest" class="onboarding__guest">
        You're in guest mode — everything is saved in this browser. Create a free account to sync across devices.
      </p>
      <div class="onboarding__actions">
        <UiButton size="sm" variant="secondary" @click="emit('dismiss')">Got it</UiButton>
        <UiButton size="sm" variant="ghost" to="/templates">Create a template</UiButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
.onboarding {
  padding: var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background-color: var(--bg-raised);
  color: var(--text-primary);
}
.onboarding--floating {
  width: 320px;
  max-width: calc(100% - 32px);
  box-shadow: var(--shadow-md);
}
.onboarding--compact {
  padding: var(--space-2-5) var(--space-3);
}
.onboarding__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}
.onboarding__title {
  padding-top: var(--space-1);
  font-size: var(--fs-15);
  line-height: var(--lh-15);
  font-weight: var(--fw-semibold);
  letter-spacing: normal;
}
.onboarding--compact .onboarding__title {
  font-size: var(--fs-14);
  line-height: var(--lh-14);
}
.onboarding__summary {
  margin-top: var(--space-1);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
.onboarding__more {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.onboarding__steps {
  margin: var(--space-3) 0 0;
  padding-left: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
.onboarding__steps li::marker {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.onboarding__guest {
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-2-5);
  border-radius: var(--radius-md);
  background-color: var(--bg-subtle);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-secondary);
}
.onboarding--compact .onboarding__guest {
  margin-top: 0;
}
.onboarding__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
.onboarding--compact .onboarding__actions {
  margin-top: var(--space-2);
}
.onboarding__chevron {
  transition: transform var(--dur-fast) var(--ease-standard);
}
.onboarding__chevron.is-open {
  transform: rotate(180deg);
}
</style>
