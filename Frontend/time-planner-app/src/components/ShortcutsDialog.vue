<!-- src/components/ShortcutsDialog.vue -->
<script setup lang="ts">
/**
 * ShortcutsDialog — keyboard shortcut reference (opened with "?" or the sidebar Keyboard button).
 * Grouped two-column lists with <UiKbd>. Not offered on touch-only devices.
 */
import { computed } from "vue";
import UiDialog from "@/components/ui/UiDialog.vue";
import UiKbd from "@/components/ui/UiKbd.vue";
import { useUIStore } from "@/stores/uiStore";

const uiStore = useUIStore();
const open = computed({
  get: () => uiStore.shortcutsOpen,
  set: (value: boolean) => {
    uiStore.shortcutsOpen = value;
  },
});

interface Shortcut {
  keys: string[][];
  label: string;
}

const GROUPS: { title: string; items: Shortcut[]; note?: string }[] = [
  {
    title: "General",
    items: [
      { keys: [["N"], ["C"]], label: "New task" },
      { keys: [["1"], ["2"], ["3"], ["4"]], label: "Planner · Today · Analytics · Templates (in Personal)" },
      { keys: [["["]], label: "Collapse or expand the sidebar" },
      { keys: [["Mod", "Z"]], label: "Undo the last delete, move, paste or duplicate" },
      { keys: [["?"]], label: "Show keyboard shortcuts" },
      { keys: [["Escape"]], label: "Close dialog, cancel drag" },
    ],
  },
  {
    title: "Planner",
    items: [
      { keys: [["T"]], label: "Go to today" },
      { keys: [["J"], ["ArrowRight"]], label: "Next week (next day on phones)" },
      { keys: [["K"], ["ArrowLeft"]], label: "Previous week (previous day on phones)" },
      { keys: [["D"]], label: "Open the week picker (week numbers, year grid)" },
      { keys: [["Mod", "C"]], label: "Copy the task under the pointer (or the selected task)" },
      { keys: [["Mod", "V"]], label: "Paste the copied task (at the pointer, after the selected task, or on the selected day)" },
    ],
    note: "Dragging a task: hold it at the left or right edge of the grid to move it to the previous or next week. Esc cancels. On phones, swipe left or right to change day. Right-click a task to copy or duplicate it, or free time to paste.",
  },
  {
    title: "Selected task",
    items: [
      { keys: [["Enter"], ["Space"]], label: "Edit" },
      { keys: [["ArrowUp"], ["ArrowDown"]], label: "Move 15 minutes earlier / later" },
      { keys: [["Shift", "ArrowUp"], ["Shift", "ArrowDown"]], label: "Shorten / extend by 15 minutes" },
      { keys: [["ArrowLeft"], ["ArrowRight"]], label: "Move to the previous / next day (crosses weeks)" },
      { keys: [["PageUp"], ["PageDown"]], label: "Move a week earlier / later" },
      { keys: [["Delete"], ["Backspace"]], label: "Delete (with undo)" },
      { keys: [["Mod", "C"]], label: "Copy" },
      { keys: [["Shift", "F10"]], label: "More actions (copy, duplicate to the next day or week)" },
    ],
  },
  {
    title: "Organizations",
    items: [
      { keys: [["O"]], label: "Switch workspace (Personal or an organization)" },
      { keys: [["1"], ["2"], ["3"], ["4"]], label: "Schedule · Board · Analytics · Members (in an organization)" },
      { keys: [["M"]], label: "Board: move the selected card to another panel" },
      { keys: [["P"]], label: "Board: schedule the selected card as a task" },
      { keys: [["Enter"]], label: "Board: open the selected card" },
    ],
    note: "The number keys follow the workspace you're in.",
  },
  {
    title: "Task editor",
    items: [
      { keys: [["Enter"]], label: "Save (in the title field)" },
      { keys: [["Mod", "Enter"]], label: "Save from any field" },
      { keys: [["ArrowDown"]], label: "From the title: jump to templates" },
    ],
  },
];
</script>

<template>
  <UiDialog v-model:open="open" title="Keyboard shortcuts" size="lg">
    <div class="shortcuts">
      <section v-for="group in GROUPS" :key="group.title" class="shortcuts__group" :aria-labelledby="`sc-${group.title}`">
        <h3 :id="`sc-${group.title}`" class="shortcuts__title">{{ group.title }}</h3>
        <dl class="shortcuts__list">
          <div v-for="item in group.items" :key="item.label" class="shortcuts__row">
            <dt class="shortcuts__label">{{ item.label }}</dt>
            <dd class="shortcuts__keys">
              <template v-for="(combo, i) in item.keys" :key="i">
                <span v-if="i > 0" class="shortcuts__or">or</span>
                <UiKbd :keys="combo" />
              </template>
            </dd>
          </div>
        </dl>
        <p v-if="group.note" class="shortcuts__note">{{ group.note }}</p>
      </section>
    </div>
  </UiDialog>
</template>

<style scoped>
.shortcuts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-6) var(--space-8);
  padding-top: var(--space-2);
}
@media (max-width: 639.98px) {
  .shortcuts {
    grid-template-columns: minmax(0, 1fr);
  }
}
.shortcuts__title {
  margin-bottom: var(--space-2);
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-medium);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.shortcuts__list {
  display: flex;
  flex-direction: column;
  margin: 0;
}
.shortcuts__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 32px;
  border-bottom: 1px solid var(--border-subtle);
}
.shortcuts__row:last-child {
  border-bottom: 0;
}
.shortcuts__label {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
.shortcuts__keys {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  flex-shrink: 0;
}
.shortcuts__note {
  margin-top: var(--space-2);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}
.shortcuts__or {
  font-size: var(--fs-11);
  color: var(--text-tertiary);
}
</style>
