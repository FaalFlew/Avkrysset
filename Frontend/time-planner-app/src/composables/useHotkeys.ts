// src/composables/useHotkeys.ts — single-key global shortcuts (UI_PLAN §5).
//
// One document listener (installed by App.vue). Views add scoped handlers with
// useHotkeyScope(); the most recently mounted scope wins, then the global map.
//
// Shortcuts are ignored while typing (input/textarea/select/contenteditable), during IME
// composition, while any overlay is open (dialogs handle their own keys), and when Ctrl/Meta/Alt
// is held — except AltGr, which Nordic layouts need for "[" and "?". Ctrl/⌘+Z (undo the last
// delete while its toast is visible) is the only modifier shortcut.

import { onBeforeUnmount, onMounted } from "vue";
import { hasOpenOverlay } from "@/components/ui/dialogStack";
import { isModKey } from "@/lib/platform";

/** Return `false` when the key was not handled (the event then continues to the next scope). */
export type HotkeyHandler = (event: KeyboardEvent) => boolean | void;
export type HotkeyMap = Record<string, HotkeyHandler>;

/** Keys that must not auto-repeat (holding N should not open the editor 30 times). */
const NO_REPEAT = new Set(["n", "c", "t", "1", "2", "3", "4"]);

const scopes: HotkeyMap[] = [];
let globalMap: HotkeyMap = {};
let undoHandler: (() => boolean) | null = null;

/** True when keyboard input goes to a text field (or similar). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "range", "reset", "submit", "color", "file", "image"].includes(type);
  }
  return false;
}

/**
 * Arrow-key shortcuts (←/→ = previous/next week) only apply when focus is on the page itself:
 * <body>, <main>, the page heading (focused after every route change), or an element that opts in
 * with [data-hotkey-arrows] — never on controls that use arrows (radiogroups, menus, the date
 * picker, task blocks).
 */
export function isNeutralTarget(target: EventTarget | null): boolean {
  const el = target as (Partial<Pick<Element, "hasAttribute" | "id">> & EventTarget) | null;
  if (!el || typeof el.hasAttribute !== "function") return true;
  if (typeof document !== "undefined" && (el === document.body || el === document.documentElement)) {
    return true;
  }
  return (
    el.hasAttribute("data-hotkey-arrows") || el.hasAttribute("data-page-heading") || el.id === "main"
  );
}

function normalizeKey(event: KeyboardEvent): string {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (isTypingTarget(event.target)) return;
  if (hasOpenOverlay.value) return;

  const key = normalizeKey(event);

  // Ctrl/⌘+Z: undo the last delete while its toast is visible.
  if (key === "z" && isModKey(event) && !event.shiftKey && !event.altKey) {
    if (undoHandler?.()) event.preventDefault();
    return;
  }

  const altGraph = event.getModifierState?.("AltGraph") ?? false;
  if ((event.ctrlKey || event.metaKey || event.altKey) && !altGraph) return;
  if (event.repeat && NO_REPEAT.has(key)) return;

  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const handler = scopes[i]![key];
    if (handler && handler(event) !== false) {
      event.preventDefault();
      return;
    }
  }
  const handler = globalMap[key];
  if (handler && handler(event) !== false) event.preventDefault();
}

/**
 * Install the global listener (App.vue). `keys` maps normalized keys ("n", "?", "[", "1") to
 * handlers; `onUndo` runs for Ctrl/⌘+Z and returns whether something was undone.
 * Returns an uninstall function.
 */
export function installHotkeys(keys: HotkeyMap, onUndo?: () => boolean): () => void {
  globalMap = keys;
  undoHandler = onUndo ?? null;
  document.addEventListener("keydown", onKeydown);
  return () => {
    document.removeEventListener("keydown", onKeydown);
    globalMap = {};
    undoHandler = null;
  };
}

/** Add view-scoped shortcuts for the lifetime of the calling component. */
export function useHotkeyScope(keys: HotkeyMap): void {
  onMounted(() => {
    scopes.push(keys);
  });
  onBeforeUnmount(() => {
    const index = scopes.lastIndexOf(keys);
    if (index !== -1) scopes.splice(index, 1);
  });
}
