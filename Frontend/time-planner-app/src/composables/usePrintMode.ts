// src/composables/usePrintMode.ts — print support for the analytics report ("Print / Save as
// PDF"; the only PDF path for guests).
//
// Print mode (entered from the Export menu via printReport(), or by the browser's own Print
// through `beforeprint`):
//   - forces the LIGHT theme (<html data-theme="light">) and makes useChartTheme re-read the
//     tokens; charts redraw without animation at devicePixelRatio 2 (crisp on paper) and, when
//     their box declares `data-print-size="680x260"`, at that fixed size (the print stylesheet
//     scales it to the page width) — so a phone prints the same chart as a desktop;
//   - expands every "View data" table (<details data-print-expand>);
//   - stamps the generated-at time shown by the print header.
// `afterprint` (or, where it is unreliable — iOS — the first interaction after window.print()
// returned) restores the user's theme, the tables and the charts.
// Layout for paper lives in src/styles/print.css (+ `@media print` blocks of the components);
// the paper size (`@page size`) is injected here from the paper preference.

import { nextTick, reactive, readonly, watch } from "vue";
import { Chart } from "chart.js";
import { now, type EpochMs } from "@/lib/datetime";
import { useTheme } from "@/composables/useTheme";
import type { PaperSize } from "@/lib/paper";

/** Canvas resolution while printing (screen DPR is often 1; paper wants more). */
export const PRINT_DEVICE_PIXEL_RATIO = 2;

/** Max time to wait for an animation frame (hidden/background tabs throttle rAF). */
const FRAME_TIMEOUT_MS = 150;

interface PrintState {
  active: boolean;
  /** When print mode was last entered (shown as "Generated …" by the print header). */
  printedAt: EpochMs;
}

const state = reactive<PrintState>({ active: false, printedAt: now() });

/** Read-only print state (reactive). */
export const printState = readonly(state);

let openedDetails: HTMLDetailsElement[] = [];

const hasDom = () => typeof document !== "undefined" && typeof window !== "undefined";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => finish());
    setTimeout(finish, FRAME_TIMEOUT_MS);
  });
}

/** "680x260" → { width: 680, height: 260 } */
function parsePrintSize(value: string | undefined | null): { width: number; height: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(value?.trim() ?? "");
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** Redraw every chart for the current mode (print: DPR 2, fixed print size, no animation). */
export function refreshCharts(): void {
  for (const chart of Object.values(Chart.instances)) {
    try {
      const options = chart.options as { devicePixelRatio?: number };
      options.devicePixelRatio = state.active ? PRINT_DEVICE_PIXEL_RATIO : undefined;
      chart.stop(); // a running animation would defer the resize (and print a half-drawn frame)
      chart.update("none");
      const box = chart.canvas?.closest<HTMLElement>("[data-print-size]");
      const size = state.active ? parsePrintSize(box?.dataset.printSize) : null;
      if (size) chart.resize(size.width, size.height);
      else chart.resize();
    } catch (error) {
      console.error("Could not redraw a chart for printing:", error);
    }
  }
}

/** After Vue re-rendered and vue-chartjs applied the new options (both on microtasks). */
function refreshChartsSoon(): Promise<void> {
  return nextTick()
    .then(() => nextTick())
    .then(refreshCharts);
}

/** Switch the page into print mode (idempotent). Synchronous DOM work + chart redraw on microtasks. */
export function enterPrintMode(): void {
  if (state.active || !hasDom()) return;
  const root = document.documentElement;
  root.classList.add("theme-switching", "is-printing");
  root.dataset.theme = "light";
  root.style.colorScheme = "light";

  openedDetails = Array.from(
    document.querySelectorAll<HTMLDetailsElement>("details[data-print-expand]:not([open])")
  );
  for (const details of openedDetails) details.open = true;

  state.printedAt = now();
  state.active = true; // after data-theme: useChartTheme re-reads the (light) tokens
  void refreshChartsSoon();
}

/** Leave print mode (idempotent): the user's theme, collapsed tables and screen charts return. */
export function exitPrintMode(): void {
  disarmExitFallback();
  if (!state.active || !hasDom()) return;
  const root = document.documentElement;
  const theme = useTheme().resolvedTheme.value;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.remove("is-printing");
  for (const details of openedDetails) details.open = false;
  openedDetails = [];

  state.active = false; // after data-theme: charts re-read the user's tokens
  void refreshChartsSoon();
  void nextFrame()
    .then(nextFrame)
    .then(() => root.classList.remove("theme-switching"));
}

/** Enter print mode and wait until the DOM and the charts are ready to be printed. */
export async function preparePrint(): Promise<void> {
  enterPrintMode();
  await nextTick();
  await nextTick();
  refreshCharts();
  await nextFrame();
}

// iOS Safari: window.print() returns immediately and `afterprint` may never fire. Leave print mode
// on the first interaction after the print sheet closed instead.
let fallbackCleanup: (() => void) | null = null;

function disarmExitFallback(): void {
  fallbackCleanup?.();
  fallbackCleanup = null;
}

function armExitFallback(): void {
  disarmExitFallback();
  if (!state.active || !hasDom()) return;
  const events = ["pointerdown", "keydown", "focus", "scroll"] as const;
  const onInteraction = () => exitPrintMode();
  const timer = window.setTimeout(() => {
    for (const type of events) window.addEventListener(type, onInteraction, { once: true, capture: true });
  }, 500);
  fallbackCleanup = () => {
    window.clearTimeout(timer);
    for (const type of events) window.removeEventListener(type, onInteraction, { capture: true });
  };
}

/** "Print / Save as PDF": prepare (await nextTick + a frame), then open the print dialog. */
export async function printReport(): Promise<void> {
  if (!hasDom()) return;
  await preparePrint();
  try {
    window.print();
  } finally {
    // Desktop browsers block in print() and fire afterprint (already back to normal by now).
    armExitFallback();
  }
}

// ---------------------------------------------------------------------------------------------
// Page setup and browser print events (installed while the analytics page is mounted)
// ---------------------------------------------------------------------------------------------

const PAGE_STYLE_ID = "tp-print-page";

/** `@page` rule for a paper size (14 mm margins). */
export function pageRule(paper: PaperSize): string {
  return `@page { size: ${paper === "Letter" ? "letter" : "A4"} portrait; margin: 14mm; }`;
}

function applyPageStyle(paper: PaperSize): void {
  let style = document.getElementById(PAGE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = PAGE_STYLE_ID;
    style.media = "print";
    document.head.appendChild(style);
  }
  style.textContent = pageRule(paper);
}

/**
 * Install print support: `@page` size from `paper`, `beforeprint`/`afterprint` (Ctrl+P / the
 * browser menu), and the print media query as a backup signal. Returns the uninstall function.
 */
export function installPrintSupport(paper: () => PaperSize): () => void {
  if (!hasDom()) return () => {};
  const stopPaper = watch(paper, (p) => applyPageStyle(p), { immediate: true });
  const onBefore = () => enterPrintMode();
  const onAfter = () => exitPrintMode();
  window.addEventListener("beforeprint", onBefore);
  window.addEventListener("afterprint", onAfter);
  const media = window.matchMedia?.("print");
  const onMedia = (event: MediaQueryListEvent) => (event.matches ? enterPrintMode() : exitPrintMode());
  media?.addEventListener?.("change", onMedia);

  return () => {
    stopPaper();
    window.removeEventListener("beforeprint", onBefore);
    window.removeEventListener("afterprint", onAfter);
    media?.removeEventListener?.("change", onMedia);
    exitPrintMode();
    document.getElementById(PAGE_STYLE_ID)?.remove();
  };
}
