<script setup lang="ts">
/**
 * AppTabBar — bottom navigation below 768px: Planner, Today, Analytics, Templates, More.
 * "More" opens AppMoreSheet (account + theme).
 */
import { RouterLink } from "vue-router";
import { Ellipsis } from "lucide-vue-next";
import { NAV_ITEMS } from "./navItems";
import { useShell } from "./useShell";
import AppMoreSheet from "./AppMoreSheet.vue";

const { moreSheetOpen } = useShell();
</script>

<template>
  <nav class="tabbar" aria-label="Primary">
    <ul role="list" class="tabbar__list">
      <li v-for="item in NAV_ITEMS" :key="item.name" class="tabbar__cell">
        <RouterLink :to="item.to" class="tab">
          <component :is="item.icon" :size="20" />
          <span class="tab__label">{{ item.label }}</span>
        </RouterLink>
      </li>
      <li class="tabbar__cell">
        <button
          type="button"
          class="tab"
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
.tab[aria-current="page"] {
  color: var(--accent-text);
}
.tab:focus-visible {
  outline-offset: -2px;
}
</style>
