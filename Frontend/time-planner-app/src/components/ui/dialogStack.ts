// src/components/ui/dialogStack.ts — one stack for every overlay (dialog, sheet, popover, menu).
//
// - Esc closes only the topmost overlay (one document listener for the whole app).
// - Outside pointerdown closes the topmost non-modal overlay (popover/menu). Modal dialogs
//   handle their own scrim click (pointerdown + click both on the scrim).
// - While any modal is open: <html> scroll is locked (with scrollbar compensation), #app is
//   `inert`, and lower modal panels are `inert` too.
// - `hasOpenOverlay` lets global hotkeys stand down while anything is open.
//
// Elements inside [data-overlay-ignore] (e.g. the toast region) never count as "outside".

import { computed, shallowRef, type ComputedRef } from "vue";
import type { OverlayCloseReason } from "./types";

export interface OverlayOptions {
  /** Modal overlays lock scroll and make the rest of the app inert. Default false. */
  modal?: boolean;
  /** Root element of the overlay (used for outside detection and inert stacking). */
  element?: () => HTMLElement | null | undefined;
  /** Close on pointerdown outside `element` while topmost. Default: !modal. */
  closeOnOutsidePointer?: boolean;
  /** Extra elements treated as "inside" (e.g. the trigger button of a popover). */
  ignore?: () => Array<Element | null | undefined>;
}

interface OverlayEntry extends OverlayOptions {
  id: string;
  close: (reason: OverlayCloseReason) => void;
}

const stack = shallowRef<readonly OverlayEntry[]>([]);

/** True while any overlay (dialog, sheet, popover, menu) is open. */
export const hasOpenOverlay: ComputedRef<boolean> = computed(() => stack.value.length > 0);
/** True while a modal dialog/sheet is open. */
export const hasOpenModal: ComputedRef<boolean> = computed(() => stack.value.some((e) => e.modal));

let idCounter = 0;
/** Unique id helper for overlays created outside a component setup. */
export function createOverlayId(prefix = "overlay"): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function register(
  id: string,
  close: (reason: OverlayCloseReason) => void,
  options: OverlayOptions = {},
): void {
  const rest = stack.value.filter((e) => e.id !== id);
  stack.value = [...rest, { id, close, ...options }];
  sync();
}

export function unregister(id: string): void {
  if (!stack.value.some((e) => e.id === id)) return;
  stack.value = stack.value.filter((e) => e.id !== id);
  sync();
}

export function isTopmost(id: string): boolean {
  const s = stack.value;
  return s.length > 0 && s[s.length - 1]!.id === id;
}

/** True when `node` sits inside an overlay registered after (above) overlay `id`. */
export function isInsideOverlayAbove(id: string, node: Node | null): boolean {
  if (!node) return false;
  const s = stack.value;
  const index = s.findIndex((e) => e.id === id);
  if (index === -1) return false;
  return s.slice(index + 1).some((e) => !!e.element?.()?.contains(node));
}

// ---------------------------------------------------------------- global listeners

function topmost(): OverlayEntry | undefined {
  const s = stack.value;
  return s[s.length - 1];
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
  const top = topmost();
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  top.close("escape");
}

function onPointerDown(event: PointerEvent): void {
  const top = topmost();
  if (!top) return;
  const closeOnOutside = top.closeOnOutsidePointer ?? !top.modal;
  if (!closeOnOutside) return;
  const target = event.target as Element | null;
  if (!target || !(target instanceof Element)) return;
  if (target.closest("[data-overlay-ignore]")) return;
  if (top.element?.()?.contains(target)) return;
  if (top.ignore?.().some((el) => el && el.contains(target))) return;
  top.close("outside");
}

let listening = false;
function syncListeners(): void {
  const needed = stack.value.length > 0;
  if (needed && !listening) {
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("pointerdown", onPointerDown, true);
    listening = true;
  } else if (!needed && listening) {
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("pointerdown", onPointerDown, true);
    listening = false;
  }
}

// ---------------------------------------------------------------- modal side effects

let scrollLock: { overflow: string; paddingRight: string } | null = null;
const inertPanels = new Set<HTMLElement>();

function lockScroll(): void {
  if (scrollLock) return;
  const html = document.documentElement;
  const scrollbarWidth = window.innerWidth - html.clientWidth;
  scrollLock = { overflow: html.style.overflow, paddingRight: html.style.paddingRight };
  html.style.overflow = "hidden";
  if (scrollbarWidth > 0) html.style.paddingRight = `${scrollbarWidth}px`;
}

function unlockScroll(): void {
  if (!scrollLock) return;
  const html = document.documentElement;
  html.style.overflow = scrollLock.overflow;
  html.style.paddingRight = scrollLock.paddingRight;
  scrollLock = null;
}

function setAppInert(inert: boolean): void {
  const app = document.getElementById("app");
  if (!app) return;
  if (inert) app.setAttribute("inert", "");
  else app.removeAttribute("inert");
}

function sync(): void {
  if (typeof document === "undefined") return;
  syncListeners();

  const modals = stack.value.filter((e) => e.modal);
  if (modals.length > 0) {
    lockScroll();
    setAppInert(true);
  } else {
    setAppInert(false);
    unlockScroll();
  }

  // Only the topmost modal stays interactive.
  const topModal = modals[modals.length - 1];
  const shouldBeInert = new Set<HTMLElement>();
  for (const entry of modals) {
    if (entry === topModal) continue;
    const el = entry.element?.();
    if (el) shouldBeInert.add(el);
  }
  for (const el of inertPanels) {
    if (!shouldBeInert.has(el)) {
      el.removeAttribute("inert");
      inertPanels.delete(el);
    }
  }
  for (const el of shouldBeInert) {
    if (!inertPanels.has(el)) {
      el.setAttribute("inert", "");
      inertPanels.add(el);
    }
  }
}
