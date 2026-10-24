// src/lib/wakeIndicator.ts — where the "Waking up the server…" pill goes
// (components/ServerWakeIndicator.vue).
//
// It shares the bottom-center spot with the toast: while a toast is visible the pill sits on top
// of it, raised by the toast's measured height (1–3 lines) plus a gap. While a modal dialog or
// bottom sheet is open the pill stands down — it would cover the sheet's content on phones — and
// the dialog's own Save button says "Waking up the server…" instead.

/** Space between the toast and the pill (px). */
export const WAKE_TOAST_GAP_PX = 8;
/** Assumed toast height while it has not been measured yet (one line + padding). */
export const FALLBACK_TOAST_HEIGHT_PX = 48;

export interface WakeIndicatorInput {
  /** A mutation has been pending for longer than SLOW_MUTATION_MS. */
  slow: boolean;
  /** A modal dialog / bottom sheet is open. */
  modalOpen: boolean;
  toastVisible: boolean;
  /** Measured toast height in px (0 = unknown). */
  toastHeight: number;
}

export interface WakeIndicatorLayout {
  visible: boolean;
  /** How far above the toast offset the pill sits (px). */
  raiseBy: number;
}

export function wakeIndicatorLayout(input: WakeIndicatorInput): WakeIndicatorLayout {
  const toastHeight = input.toastHeight > 0 ? input.toastHeight : FALLBACK_TOAST_HEIGHT_PX;
  return {
    visible: input.slow && !input.modalOpen,
    raiseBy: input.toastVisible ? toastHeight + WAKE_TOAST_GAP_PX : 0,
  };
}
