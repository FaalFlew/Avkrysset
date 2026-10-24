<script setup lang="ts">
/**
 * UiKbd — keyboard shortcut keys.
 * Props:
 *   keys: string[] — e.g. ['N'], ['Mod', 'Enter'], ['Shift', 'ArrowUp'].
 *     'Mod' → ⌘ on Mac / Ctrl elsewhere; 'Enter' → ↵; 'Shift' → ⇧ (Mac) / Shift;
 *     'Alt' → ⌥ (Mac) / Alt; 'ArrowUp|Down|Left|Right' → ↑ ↓ ← →; 'Escape' → Esc.
 *     Symbols carry sr-only names ("Command", "Enter", "Up arrow").
 *   tone?: 'default' | 'onAccent' | 'inverse' — onAccent for primary buttons, inverse inside tooltips.
 */
import { computed } from "vue";
import { isMac } from "@/lib/platform";

const props = withDefaults(defineProps<{ keys: string[]; tone?: "default" | "onAccent" | "inverse" }>(), {
  tone: "default",
});

interface KeyDisplay {
  glyph: string;
  name: string | null;
}

function display(key: string): KeyDisplay {
  switch (key) {
    case "Mod":
      return isMac ? { glyph: "⌘", name: "Command" } : { glyph: "Ctrl", name: null };
    case "Ctrl":
    case "Control":
      return { glyph: "Ctrl", name: null };
    case "Meta":
    case "Cmd":
      return { glyph: "⌘", name: "Command" };
    case "Shift":
      return isMac ? { glyph: "⇧", name: "Shift" } : { glyph: "Shift", name: null };
    case "Alt":
    case "Option":
      return isMac ? { glyph: "⌥", name: "Option" } : { glyph: "Alt", name: null };
    case "Enter":
    case "Return":
      return { glyph: "↵", name: "Enter" };
    case "ArrowUp":
      return { glyph: "↑", name: "Up arrow" };
    case "ArrowDown":
      return { glyph: "↓", name: "Down arrow" };
    case "ArrowLeft":
      return { glyph: "←", name: "Left arrow" };
    case "ArrowRight":
      return { glyph: "→", name: "Right arrow" };
    case "Escape":
    case "Esc":
      return { glyph: "Esc", name: null };
    case "Backspace":
      return isMac ? { glyph: "⌫", name: "Backspace" } : { glyph: "Backspace", name: null };
    case "Delete":
      return { glyph: "Del", name: "Delete" };
    case " ":
    case "Space":
      return { glyph: "Space", name: null };
    default:
      return { glyph: key.length === 1 ? key.toUpperCase() : key, name: null };
  }
}

const items = computed(() => props.keys.map(display));
</script>

<template>
  <span class="ui-kbd-group" :class="`ui-kbd-group--${tone}`">
    <kbd v-for="(item, index) in items" :key="index" class="ui-kbd">
      <template v-if="item.name">
        <span aria-hidden="true">{{ item.glyph }}</span>
        <span class="sr-only">{{ item.name }}</span>
      </template>
      <template v-else>{{ item.glyph }}</template>
    </kbd>
  </span>
</template>

<style scoped>
.ui-kbd-group {
  display: inline-flex;
  align-items: center;
  gap: var(--space-0-5);
  flex-shrink: 0;
}

.ui-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  min-width: 18px;
  padding: 0 var(--space-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xs);
  background-color: var(--bg-subtle);
  color: var(--text-secondary);
  font-family: var(--font-sans);
  font-size: var(--fs-11);
  line-height: 1;
  font-weight: var(--fw-medium);
  white-space: nowrap;
}

/*
 * On accent buttons a dark overlay keeps white text ≥ 6.5:1
 * (the spec's white 18% overlay measured 3.6–3.9:1, below AA for 11px text).
 */
.ui-kbd-group--onAccent .ui-kbd {
  border-color: transparent;
  background-color: rgb(0 0 0 / 0.2);
  color: var(--text-on-accent);
}

/* Inside tooltips (inverse surface). */
.ui-kbd-group--inverse .ui-kbd {
  border-color: transparent;
  background-color: color-mix(in srgb, var(--text-inverse) 14%, transparent);
  color: var(--text-inverse);
}

@media (forced-colors: active) {
  .ui-kbd {
    border-color: CanvasText;
  }
}
</style>
