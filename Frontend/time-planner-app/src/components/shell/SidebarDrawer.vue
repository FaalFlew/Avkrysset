<script setup lang="ts">
/**
 * SidebarDrawer — the expanded sidebar as a modal overlay drawer (tablets, 768–1023px).
 * Scrim, focus trap, Esc / scrim click close it, focus returns to the opener. Never pushes the
 * content. Closes itself on navigation and when the viewport leaves the tablet range.
 */
import { nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { useRoute } from "vue-router";
import AppSidebar from "./AppSidebar.vue";
import { useShell } from "./useShell";
import { registerOverlay, unregisterOverlay } from "@/components/ui";
import { useFocusTrap } from "@/composables/useFocusTrap";
import { useBreakpoint } from "@/composables/useMediaQuery";

const { drawerOpen, closeDrawer } = useShell();
const { isTablet, prefersReducedMotion } = useBreakpoint();
const route = useRoute();

const overlayId = `sidebar-drawer-${useId()}`;
const panel = ref<HTMLElement | null>(null);
const trap = useFocusTrap(panel);
let active = false;

async function activate(): Promise<void> {
  if (active) return;
  active = true;
  registerOverlay(overlayId, () => closeDrawer(), { modal: true, element: () => panel.value });
  await nextTick();
  trap.activate();
}

function deactivate(): void {
  if (!active) return;
  active = false;
  unregisterOverlay(overlayId);
  trap.deactivate();
}

watch(drawerOpen, (open) => (open ? void activate() : deactivate()), { immediate: true });
watch(() => route.fullPath, () => closeDrawer());
watch(isTablet, (tablet) => {
  if (!tablet) closeDrawer();
});
onBeforeUnmount(() => {
  deactivate();
  closeDrawer();
});
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer" :duration="prefersReducedMotion ? 0 : { enter: 250, leave: 150 }">
      <div v-if="drawerOpen" class="drawer">
        <div class="drawer__scrim" aria-hidden="true" @click="closeDrawer" />
        <div
          ref="panel"
          class="drawer__panel"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          tabindex="-1"
        >
          <AppSidebar variant="expanded" in-drawer @close="closeDrawer" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
}
.drawer__scrim {
  position: absolute;
  inset: 0;
  background-color: var(--bg-scrim);
}
.drawer__panel {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  display: flex;
  border-right: 1px solid var(--border-default);
  box-shadow: var(--shadow-lg);
  outline: none;
}

.drawer-enter-active .drawer__scrim,
.drawer-enter-active .drawer__panel {
  transition: opacity var(--dur-slow) var(--ease-out), transform var(--dur-slow) var(--ease-out);
}
.drawer-leave-active .drawer__scrim,
.drawer-leave-active .drawer__panel {
  transition: opacity var(--dur-fast) var(--ease-in), transform var(--dur-fast) var(--ease-in);
}
.drawer-enter-from .drawer__scrim,
.drawer-leave-to .drawer__scrim {
  opacity: 0;
}
.drawer-enter-from .drawer__panel,
.drawer-leave-to .drawer__panel {
  transform: translateX(-100%);
}
</style>
