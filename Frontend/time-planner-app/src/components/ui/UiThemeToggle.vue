<script setup lang="ts">
/**
 * UiThemeToggle — light / dark / system switch (uses useTheme()).
 * Props:
 *   variant?: 'segmented' | 'cycle' (default 'segmented')
 *     segmented — Sun / Moon / Monitor radiogroup ("Light", "Dark", "System")
 *     cycle — one icon button showing the current mode; click goes light → dark → system
 *   size?: 'sm' | 'md' (default 'sm')
 *   showLabels?: boolean — segmented only: show text labels next to the icons (default false:
 *     icon-only with tooltips)
 *   block?: boolean — segmented only: full width
 */
import { computed } from "vue";
import { Monitor, Moon, Sun } from "lucide-vue-next";
import UiIconButton from "./UiIconButton.vue";
import UiSegmentedControl from "./UiSegmentedControl.vue";
import type { SegmentOption } from "./types";
import { useTheme, type ThemeMode } from "@/composables/useTheme";

const props = withDefaults(
  defineProps<{ variant?: "segmented" | "cycle"; size?: "sm" | "md"; showLabels?: boolean; block?: boolean }>(),
  { variant: "segmented", size: "sm", showLabels: false, block: false },
);

const { mode, setMode, cycleMode } = useTheme();

const LABELS: Record<ThemeMode, string> = { light: "Light", dark: "Dark", system: "System" };
const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

const options: SegmentOption<ThemeMode>[] = (["light", "dark", "system"] as const).map((value) => ({
  value,
  label: LABELS[value],
  icon: ICONS[value],
  ariaLabel: `${LABELS[value]} theme`,
}));

const cycleLabel = computed(() => `Theme: ${LABELS[mode.value]}`);
const cycleIcon = computed(() => ICONS[mode.value]);
function onModeChange(value: string | number): void {
  setMode(value as ThemeMode);
}

const iconSize = computed(() => (props.size === "sm" ? 16 : 18));
</script>

<template>
  <UiIconButton
    v-if="variant === 'cycle'"
    :label="cycleLabel"
    :size="size === 'sm' ? 'md' : 'lg'"
    tooltip-placement="bottom"
    @click="cycleMode"
  >
    <component :is="cycleIcon" :size="iconSize" />
  </UiIconButton>
  <UiSegmentedControl
    v-else
    :model-value="mode"
    :options="options"
    aria-label="Theme"
    :size="size"
    :block="block"
    :icon-only="!showLabels"
    @update:model-value="onModeChange"
  />
</template>
