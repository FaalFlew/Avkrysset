// src/components/ui/floating.ts — positioning for floating layers (tooltip, popover, menu).
// Internal helper of the UI primitives; content is `position: fixed` and teleported to <body>.

import { nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { AnchorRect, FloatingPlacement } from "./types";

export interface FloatingPosition {
  top: number;
  left: number;
  placement: FloatingPlacement;
}

const VIEWPORT_MARGIN = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Pure placement math with flipping and viewport clamping. */
export function computeFloatingPosition(
  anchor: AnchorRect,
  size: { width: number; height: number },
  placement: FloatingPlacement,
  offset = 6,
): FloatingPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const { width: w, height: h } = size;
  const [side, align] = placement.split("-") as ["top" | "bottom" | "left" | "right", "start" | "end" | undefined];

  if (side === "top" || side === "bottom") {
    const below = anchor.bottom + offset;
    const above = anchor.top - offset - h;
    const fitsBelow = below + h <= vh - VIEWPORT_MARGIN;
    const fitsAbove = above >= VIEWPORT_MARGIN;
    let finalSide = side;
    if (side === "bottom" && !fitsBelow && fitsAbove) finalSide = "top";
    if (side === "top" && !fitsAbove && fitsBelow) finalSide = "bottom";
    const top = clamp(finalSide === "bottom" ? below : above, VIEWPORT_MARGIN, vh - h - VIEWPORT_MARGIN);

    let left: number;
    if (align === "start") left = anchor.left;
    else if (align === "end") left = anchor.right - w;
    else left = anchor.left + anchor.width / 2 - w / 2;
    left = clamp(left, VIEWPORT_MARGIN, vw - w - VIEWPORT_MARGIN);

    return { top, left, placement: (align ? `${finalSide}-${align}` : finalSide) as FloatingPlacement };
  }

  const toRight = anchor.right + offset;
  const toLeft = anchor.left - offset - w;
  let finalSide = side;
  if (side === "right" && toRight + w > vw - VIEWPORT_MARGIN && toLeft >= VIEWPORT_MARGIN) finalSide = "left";
  if (side === "left" && toLeft < VIEWPORT_MARGIN && toRight + w <= vw - VIEWPORT_MARGIN) finalSide = "right";
  const left = clamp(finalSide === "right" ? toRight : toLeft, VIEWPORT_MARGIN, vw - w - VIEWPORT_MARGIN);
  const top = clamp(anchor.top + anchor.height / 2 - h / 2, VIEWPORT_MARGIN, vh - h - VIEWPORT_MARGIN);
  return { top, left, placement: finalSide };
}

/**
 * Keeps `floating` positioned next to `anchor()` while `isOpen()` is true.
 * Returns a reactive style object and an `update` function. The first measurement happens in the
 * same microtask burst as the insertion (before paint), and the position is also written straight
 * to the element so it is correct (and focusable) before the next render flush.
 */
export function useFloating(
  anchor: () => Element | null | undefined,
  floating: Ref<HTMLElement | null | undefined>,
  options: { placement: () => FloatingPlacement; isOpen: () => boolean; offset?: number },
) {
  const style = ref<Record<string, string>>({ position: "fixed", top: "0px", left: "0px" });
  const placement = ref<FloatingPlacement>(options.placement());
  let frame = 0;
  let observer: ResizeObserver | null = null;

  function update(): void {
    const anchorEl = anchor();
    const el = floating.value;
    if (!anchorEl || !el) return;
    const rect = anchorEl.getBoundingClientRect();
    const pos = computeFloatingPosition(
      rect,
      { width: el.offsetWidth, height: el.offsetHeight },
      options.placement(),
      options.offset ?? 6,
    );
    placement.value = pos.placement;
    const top = `${Math.round(pos.top)}px`;
    const left = `${Math.round(pos.left)}px`;
    el.style.top = top;
    el.style.left = left;
    style.value = { position: "fixed", top, left };
  }

  function schedule(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  }

  function start(): void {
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    if (typeof ResizeObserver !== "undefined" && floating.value) {
      observer = new ResizeObserver(schedule);
      observer.observe(floating.value);
    }
  }

  function stop(): void {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, { capture: true });
    observer?.disconnect();
    observer = null;
  }

  watch(
    options.isOpen,
    async (open) => {
      stop();
      if (!open) return;
      await nextTick();
      update();
      start();
    },
    { immediate: true },
  );

  onBeforeUnmount(stop);

  return { style, placement, update };
}
