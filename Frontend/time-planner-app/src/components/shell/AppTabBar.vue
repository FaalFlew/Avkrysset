<script setup lang="ts">
/**
 * AppTabBar — bottom navigation below 768px: the first four pages of the current workspace
 * (Personal: Planner, Today, Analytics, Templates; an org: Schedule, Board, Analytics, Members),
 * then More. "More" opens AppMoreSheet (workspace switcher, the remaining pages, account, theme).
 */
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { Ellipsis } from "lucide-vue-next";
import { useShell } from "./useShell";
import { useWorkspace } from "./useWorkspace";
import AppMoreSheet from "./AppMoreSheet.vue";

const route = useRoute();
const { moreSheetOpen } = useShell();
const { primaryItems, overflowItems } = useWorkspace();

/** "More" is the current tab when the page lives in the sheet (e.g. org Activity / Settings). */
const moreIsCurrent = computed(() => overflowItems.value.some((item) => item.name === route.name));
const columns = computed(() => `repeat(${primaryItems.value.length + 1}, 1fr)`);
</script>

<template>
  <nav class="tabbar" aria-label="Primary">
    <ul role="list" class="tabbar__list" :style="{ gridTemplateColumns: columns }">
      <li v-for="item in primaryItems" :key="item.name" class="tabbar__cell">
        <RouterLink :to="item.to" class="tab">
          <component :is="item.icon" :size="20" />
          <span class="tab__label">{{ item.label }}</span>
        </RouterLink>
      </li>
      <li class="tabbar__cell">
        <button
          type="button"
          class="tab"
          :class="{ 'is-current': moreIsCurrent }"
          aria-haspopup="dialog"
          :aria-expanded="moreSheetOpen"
          @click="moreSheetOpen = true"
        >
          <Ellipsis :size="20" />
          <span class="tab__label">More</span>
        </button>
      </li>
    </ul>
  </nav>
  <AppMoreSheet v-model:open="moreSheetOpen" />
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-tabbar);
  height: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background-color: var(--bg-surface);
  border-top: 1px solid var(--border-default);
}
.tabbar__list {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  height: var(--tabbar-h);
}
.tabbar__cell {
  display: flex;
  min-width: 0;
}
.tab {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 48px;
  min-height: 48px;
  color: var(--text-tertiary);
  text-decoration: none;
  border-radius: var(--radius-md);
  transition: color var(--dur-fast) var(--ease-standard);
}
.tab__label {
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-medium);
  white-space: nowrap;
}
.tab[aria-current="page"],
.tab.is-current {
  color: var(--accent-text);
}
.tab:focus-visible {
  outline-offset: -2px;
}
</style>
