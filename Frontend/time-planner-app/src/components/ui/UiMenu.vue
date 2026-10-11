<script setup lang="ts">
/**
 * UiMenu — action menu (role="menu") anchored to a trigger.
 * Props:
 *   items: MenuItem[] — { id, label, icon?, danger?, shortcut?, disabled?, description?,
 *     checked?, keepOpen?, group?, ariaLabel?, onSelect }
 *     - description: secondary line (e.g. why an item is disabled), exposed via aria-describedby
 *     - checked: makes the item a menuitemradio (aria-checked) with a check mark when true
 *     - keepOpen: selecting does not close the menu (radio choices)
 *     - group: consecutive items with the same group are wrapped in a labelled role="group";
 *       groups are separated by a role="separator" line
 *   placement?: 'bottom-start' | 'bottom-end' (default 'bottom-end'; flips above when needed)
 *   open?: boolean (v-model:open; optional)
 * Slots:
 *   trigger ({ open, toggle, triggerProps }) — spread `v-bind="triggerProps"` on your button
 *     (id, aria-haspopup="menu", aria-expanded, aria-controls, onKeydown for ↓/↑ to open) and
 *     call `toggle` on click. Works with UiIconButton/UiButton (attrs reach the native button).
 * Keyboard: ↑/↓ (wrapping), Home/End, Enter/Space select, Esc closes and returns focus,
 * Tab closes, first-letter typeahead. Items are 32px (44px on coarse pointers); danger items
 * use --danger-text. Selecting closes the menu, returns focus to the trigger, then calls
 * onSelect (so a dialog opened from onSelect returns focus to the trigger).
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { Check } from "lucide-vue-next";
import UiKbd from "./UiKbd.vue";
import { useFloating } from "./floating";
import { hasOpenModal, register, unregister } from "./dialogStack";
import type { MenuItem, OverlayCloseReason } from "./types";

const props = withDefaults(defineProps<{ items: MenuItem[]; placement?: "bottom-start" | "bottom-end" }>(), {
  placement: "bottom-end",
});

const open = defineModel<boolean>("open", { default: false });

const uid = useId();
const overlayId = `ui-menu-${uid}`;
const menuId = `${overlayId}-list`;
const triggerId = `${overlayId}-trigger`;
const anchorRef = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const zIndex = ref("var(--z-popover)");
const itemEls: (HTMLButtonElement | null)[] = [];
let pendingFocus: "first" | "last" = "first";

/** Consecutive items of the same `group`, in order (indexes are positions in `items`). */
const sections = computed(() => {
  const list: { key: string; label: string | undefined; entries: { item: MenuItem; index: number }[] }[] = [];
  props.items.forEach((item, index) => {
    const last = list[list.length - 1];
    if (last && last.label === item.group) last.entries.push({ item, index });
    else list.push({ key: `${list.length}-${item.group ?? ""}`, label: item.group, entries: [{ item, index }] });
  });
  return list;
});

function setItemRef(el: unknown, index: number): void {
  itemEls[index] = el instanceof HTMLButtonElement ? el : null;
}

function triggerEl(): HTMLElement | null {
  return (anchorRef.value?.firstElementChild as HTMLElement | null) ?? null;
}

const { style: floatingStyle } = useFloating(triggerEl, menuRef, {
  placement: () => props.placement,
  isOpen: () => open.value,
  offset: 4,
});

function focusItem(index: number): void {
  itemEls[index]?.focus({ preventScroll: true });
}

function currentIndex(): number {
  return itemEls.findIndex((el) => el === document.activeElement);
}

function openMenu(focus: "first" | "last" = "first"): void {
  pendingFocus = focus;
  open.value = true;
}

function close(returnFocus = true): void {
  if (!open.value) return;
  open.value = false;
  if (returnFocus) triggerEl()?.focus({ preventScroll: true });
}

function toggle(): void {
  if (open.value) close();
  else openMenu("first");
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openMenu(event.key === "ArrowDown" ? "first" : "last");
  }
}

const triggerProps = computed(() => ({
  id: triggerId,
  "aria-haspopup": "menu" as const,
  "aria-expanded": open.value,
  "aria-controls": open.value ? menuId : undefined,
  onKeydown: onTriggerKeydown,
}));

function select(item: MenuItem): void {
  if (item.disabled) return;
  if (item.keepOpen) {
    item.onSelect();
    return;
  }
  close(true);
  item.onSelect();
}

function onMenuKeydown(event: KeyboardEvent): void {
  const count = props.items.length;
  if (count === 0) return;
  const index = currentIndex();
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      focusItem(index === -1 ? 0 : (index + 1) % count);
      return;
    case "ArrowUp":
      event.preventDefault();
      focusItem(index === -1 ? count - 1 : (index - 1 + count) % count);
      return;
    case "Home":
      event.preventDefault();
      focusItem(0);
      return;
    case "End":
      event.preventDefault();
      focusItem(count - 1);
      return;
    case "Enter":
    case " ": {
      event.preventDefault();
      const item = props.items[index];
      if (item) select(item);
      return;
    }
    case "Tab":
      // Return to the trigger; the default Tab action then continues from there.
      close(true);
      return;
    default:
      break;
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const char = event.key.toLowerCase();
    for (let step = 1; step <= count; step++) {
      const next = (index + step + count) % count;
      if (props.items[next]?.label.toLowerCase().startsWith(char)) {
        focusItem(next);
        break;
      }
    }
  }
}

function onStackClose(reason: OverlayCloseReason): void {
  close(reason === "escape" || reason === "outside");
}

let registered = false;
watch(
  open,
  async (isOpen) => {
    if (isOpen) {
      zIndex.value = hasOpenModal.value ? "calc(var(--z-modal) + 1)" : "var(--z-popover)";
      register(overlayId, onStackClose, { element: () => menuRef.value, ignore: () => [anchorRef.value] });
      registered = true;
      await nextTick();
      focusItem(pendingFocus === "first" ? 0 : props.items.length - 1);
      pendingFocus = "first";
    } else if (registered) {
      registered = false;
      unregister(overlayId);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (registered) unregister(overlayId);
});

defineExpose({ close, toggle });
</script>

<template>
  <span ref="anchorRef" class="ui-menu-anchor">
    <slot name="trigger" :open="open" :toggle="toggle" :triggerProps="triggerProps" />
  </span>
  <Teleport to="body">
    <Transition name="ui-menu">
      <div
        v-if="open"
        :id="menuId"
        ref="menuRef"
        class="ui-menu"
        role="menu"
        :aria-labelledby="triggerId"
        tabindex="-1"
        data-ui-floating
        :style="{ ...floatingStyle, zIndex }"
        @keydown="onMenuKeydown"
      >
        <template v-for="(section, sectionIndex) in sections" :key="section.key">
          <div v-if="sectionIndex > 0" role="separator" class="ui-menu__separator"></div>
          <div
            class="ui-menu__section"
            :role="section.label ? 'group' : undefined"
            :aria-labelledby="section.label ? `${menuId}-group-${sectionIndex}` : undefined"
          >
            <div
              v-if="section.label"
              :id="`${menuId}-group-${sectionIndex}`"
              class="ui-menu__group-label"
              role="presentation"
            >
              {{ section.label }}
            </div>
            <button
              v-for="{ item, index } in section.entries"
              :key="item.id"
              :ref="(el) => setItemRef(el, index)"
              type="button"
              :role="item.checked === undefined ? 'menuitem' : 'menuitemradio'"
              tabindex="-1"
              class="ui-menu__item"
              :class="{ 'is-danger': item.danger, 'has-description': !!item.description }"
              :aria-checked="item.checked === undefined ? undefined : item.checked"
              :aria-disabled="item.disabled || undefined"
              :aria-label="item.ariaLabel ?? (item.description ? item.label : undefined)"
              :aria-describedby="item.description ? `${menuId}-desc-${index}` : undefined"
              :data-menu-item="item.id"
              @click="select(item)"
              @pointermove="!item.disabled && focusItem(index)"
            >
              <component :is="item.icon" v-if="item.icon" :size="16" class="ui-menu__icon" />
              <span class="ui-menu__text">
                <span class="ui-menu__label">{{ item.label }}</span>
                <span v-if="item.description" :id="`${menuId}-desc-${index}`" class="ui-menu__description">
                  {{ item.description }}
                </span>
              </span>
              <Check v-if="item.checked" :size="16" class="ui-menu__check" aria-hidden="true" />
              <UiKbd v-if="item.shortcut?.length" :keys="item.shortcut" />
            </button>
          </div>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ui-menu-anchor {
  display: contents;
}

.ui-menu {
  display: flex;
  flex-direction: column;
  min-width: 180px;
  max-width: min(320px, calc(100vw - 16px));
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  padding: var(--space-1);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background-color: var(--bg-raised);
  box-shadow: var(--shadow-md);
  outline: none;
}

.ui-menu__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-standard);
}
.ui-menu__item:focus {
  outline: none;
  background-color: var(--bg-subtle);
}
.ui-menu__item:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}
.ui-menu__item.has-description {
  padding-top: var(--space-1-5);
  padding-bottom: var(--space-1-5);
}
.ui-menu__icon {
  color: var(--text-tertiary);
}
.ui-menu__item.has-description .ui-menu__icon {
  align-self: flex-start;
  margin-top: 1px;
}
.ui-menu__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}
.ui-menu__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ui-menu__description {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
  white-space: normal;
}
.ui-menu__check {
  color: var(--accent-text);
}

.ui-menu__separator {
  height: 1px;
  margin: var(--space-1) calc(-1 * var(--space-1));
  background-color: var(--border-subtle);
}
.ui-menu__group-label {
  padding: var(--space-1) var(--space-2) var(--space-0-5);
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-medium);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.ui-menu__section {
  display: flex;
  flex-direction: column;
}

.ui-menu__item.is-danger,
.ui-menu__item.is-danger .ui-menu__icon {
  color: var(--danger-text);
}
.ui-menu__item.is-danger:focus {
  background-color: var(--danger-subtle);
}

.ui-menu__item[aria-disabled="true"] .ui-menu__label,
.ui-menu__item[aria-disabled="true"] .ui-menu__icon {
  opacity: 0.5;
}
.ui-menu__item[aria-disabled="true"] {
  cursor: not-allowed;
}

@media (pointer: coarse) {
  .ui-menu__item {
    min-height: 44px;
  }
}

.ui-menu-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.ui-menu-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in);
}
.ui-menu-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.ui-menu-leave-to {
  opacity: 0;
}

@media (forced-colors: active) {
  .ui-menu {
    border-color: CanvasText;
  }
  .ui-menu__item:focus {
    outline: 2px solid Highlight;
    outline-offset: -2px;
  }
}
</style>
