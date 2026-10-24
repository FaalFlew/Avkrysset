<script setup lang="ts">
/**
 * PlannerContextMenu — the planner's right-click menu: a UiMenu opened at a point (x, y) in
 * viewport px. An invisible fixed anchor sits at that point; UiMenu returns focus to its trigger
 * on close, so the anchor hands focus on to `returnFocus` (the task block or the grid) — keyboard
 * users continue where they were.
 * Props: items, x, y, label (the menu's accessible name), returnFocus. v-model:open.
 */
import UiMenu from "@/components/ui/UiMenu.vue";
import type { MenuItem } from "@/components/ui/types";

const props = defineProps<{
  items: MenuItem[];
  x: number;
  y: number;
  label: string;
  returnFocus: HTMLElement | null;
}>();
const open = defineModel<boolean>("open", { default: false });

function onAnchorFocus(): void {
  const target = props.returnFocus;
  if (target?.isConnected) target.focus({ preventScroll: true });
}
</script>

<template>
  <UiMenu v-model:open="open" :items="items" placement="bottom-start">
    <template #trigger="{ triggerProps }">
      <span
        :id="triggerProps.id"
        class="context-anchor"
        tabindex="-1"
        aria-hidden="true"
        :aria-label="label"
        :style="{ left: `${x}px`, top: `${y}px` }"
        @focus="onAnchorFocus"
      />
    </template>
  </UiMenu>
</template>

<style scoped>
.context-anchor {
  position: fixed;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
  outline: none;
}
</style>
