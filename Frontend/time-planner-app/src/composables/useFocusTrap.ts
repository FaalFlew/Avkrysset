// src/composables/useFocusTrap.ts — keeps Tab / Shift+Tab inside a container (modal dialogs).
//
// Traps stack: only the most recently activated trap handles Tab, so nested dialogs work.
// Focus inside a floating layer marked [data-ui-floating] (popover/menu teleported to <body>)
// is left alone, because those layers manage their own Tab behaviour.

import { getCurrentScope, onScopeDispose, readonly, ref, type Ref } from "vue";

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
  "[tabindex]",
].join(",");

function isVisible(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

/** Tabbable elements inside `container`, in DOM order (skips tabindex=-1, hidden and inert). */
export function getFocusableElements(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.tabIndex >= 0 && !el.closest("[inert]") && isVisible(el),
  );
}

const FIELD_SELECTOR =
  'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select:not([disabled]), textarea:not([disabled])';

export type InitialFocusTarget = string | HTMLElement | null | undefined;

export interface FocusTrapOptions {
  /**
   * Element (or selector inside the container) to focus on activate. Falls back to
   * [data-autofocus] → first text field → first tabbable element → the container itself.
   */
  initialFocus?: () => InitialFocusTarget;
  /** Return focus to the element that was focused before activate (default true). */
  returnFocus?: boolean;
}

interface TrapEntry {
  container: () => HTMLElement | null | undefined;
}

const traps: TrapEntry[] = [];
let listening = false;

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const top = traps[traps.length - 1];
  const container = top?.container();
  if (!container) return;

  const active = document.activeElement as HTMLElement | null;
  // A floating layer above the dialog handles its own Tab key.
  if (active && !container.contains(active) && active.closest("[data-ui-floating]")) return;

  const focusables = getFocusableElements(container);
  if (focusables.length === 0) {
    event.preventDefault();
    container.focus({ preventScroll: true });
    return;
  }
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;

  if (!active || !container.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function syncListener(): void {
  if (traps.length > 0 && !listening) {
    document.addEventListener("keydown", onDocumentKeydown);
    listening = true;
  } else if (traps.length === 0 && listening) {
    document.removeEventListener("keydown", onDocumentKeydown);
    listening = false;
  }
}

/** Focus `target` (element or selector inside `container`) or the best fallback. */
export function focusInitial(container: HTMLElement, target?: InitialFocusTarget): void {
  let el: HTMLElement | null = null;
  if (target instanceof HTMLElement) el = target;
  else if (typeof target === "string" && target) el = container.querySelector<HTMLElement>(target);

  el ??= container.querySelector<HTMLElement>("[data-autofocus]");
  el ??= Array.from(container.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).find(isVisible) ?? null;
  el ??= getFocusableElements(container)[0] ?? null;
  if (!el) {
    if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
    el = container;
  }
  el.focus({ preventScroll: true });
}

export interface FocusTrap {
  activate: () => void;
  deactivate: (options?: { returnFocus?: boolean }) => void;
  isActive: Readonly<Ref<boolean>>;
}

/**
 * Trap focus inside `target` while active.
 * `activate()` remembers the currently focused element and moves focus inside;
 * `deactivate()` releases the trap and (by default) returns focus to that element.
 * The trap is released automatically when the owning component/scope is disposed.
 */
export function useFocusTrap(
  target: Ref<HTMLElement | null | undefined>,
  options: FocusTrapOptions = {},
): FocusTrap {
  const isActive = ref(false);
  let opener: HTMLElement | null = null;
  const entry: TrapEntry = { container: () => target.value };

  function activate(): void {
    if (isActive.value) return;
    const active = document.activeElement;
    opener = active instanceof HTMLElement && active !== document.body ? active : null;
    traps.push(entry);
    syncListener();
    isActive.value = true;
    const container = target.value;
    if (container && !container.contains(document.activeElement)) {
      focusInitial(container, options.initialFocus?.());
    }
  }

  function deactivate({ returnFocus = options.returnFocus ?? true } = {}): void {
    if (!isActive.value) return;
    const index = traps.indexOf(entry);
    if (index !== -1) traps.splice(index, 1);
    syncListener();
    isActive.value = false;
    const toFocus = opener;
    opener = null;
    if (returnFocus && toFocus && toFocus.isConnected && !toFocus.closest("[inert]")) {
      toFocus.focus({ preventScroll: true });
    }
  }

  if (getCurrentScope()) onScopeDispose(() => deactivate());

  return { activate, deactivate, isActive: readonly(isActive) };
}
