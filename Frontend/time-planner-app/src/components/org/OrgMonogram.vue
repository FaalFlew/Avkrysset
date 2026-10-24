<script setup lang="ts">
/**
 * OrgMonogram — an organization's one/two-letter badge in its colour (decorative: aria-hidden;
 * always put the org name next to it as text). Without `name` it shows the Personal workspace
 * icon. The fill is the org colour tinted into the surface like a task block, so the letters keep
 * ≥ 4.5:1 in both themes; the ring uses the colour adjusted to ≥ 3:1.
 * Props:
 *   name?: string — org name (null/undefined = Personal)
 *   color?: string — "#RRGGBB" (org.color)
 *   size?: 'sm' (20) | 'md' (24) | 'lg' (32) — default 'md'
 */
import { computed } from "vue";
import { UserRound } from "lucide-vue-next";
import { orgMonogram } from "@/lib/taskAccess";
import { blockColors, isHex } from "@/lib/color";
import { useTheme } from "@/composables/useTheme";

const props = withDefaults(defineProps<{ name?: string | null; color?: string | null; size?: "sm" | "md" | "lg" }>(), {
  name: null,
  color: null,
  size: "md",
});

const { resolvedTheme } = useTheme();
const letters = computed(() => (props.name ? orgMonogram(props.name) : ""));
const style = computed(() => {
  if (!props.name || !isHex(props.color)) return undefined;
  const palette = blockColors(props.color, resolvedTheme.value);
  return { "--_org": palette.color, "--_tint": palette.tint };
});
const iconSize = computed(() => ({ sm: 12, md: 14, lg: 18 })[props.size]);
</script>

<template>
  <span class="org-monogram" :class="[`org-monogram--${size}`, { 'org-monogram--personal': !name }]" :style="style" aria-hidden="true">
    <template v-if="name">{{ letters }}</template>
    <UserRound v-else :size="iconSize" />
  </span>
</template>

<style scoped>
.org-monogram {
  --_org: var(--text-tertiary);
  --_tint: 18%;
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background-color: color-mix(in srgb, var(--_org) var(--_tint), var(--bg-surface));
  box-shadow: inset 0 0 0 1px var(--_org);
  color: var(--text-primary);
  font-weight: var(--fw-semibold);
  letter-spacing: 0;
  line-height: 1;
  user-select: none;
}
.org-monogram--sm {
  width: 20px;
  height: 20px;
  font-size: var(--fs-11);
  border-radius: var(--radius-xs);
}
.org-monogram--md {
  width: 24px;
  height: 24px;
  font-size: var(--fs-11);
}
.org-monogram--lg {
  width: 32px;
  height: 32px;
  font-size: var(--fs-13);
}
.org-monogram--personal {
  background-color: var(--bg-muted);
  box-shadow: none;
  color: var(--text-secondary);
}
@media (forced-colors: active) {
  .org-monogram {
    border: 1px solid CanvasText;
  }
}
</style>
