/** src/lib/wakeIndicator.ts: the "Waking up the server…" pill's visibility and offset. */
import { describe, expect, it } from "vitest";
import { FALLBACK_TOAST_HEIGHT_PX, WAKE_TOAST_GAP_PX, wakeIndicatorLayout } from "../wakeIndicator";

const base = { slow: true, modalOpen: false, toastVisible: false, toastHeight: 0 };

describe("wakeIndicatorLayout", () => {
  it("shows only while a mutation is slow", () => {
    expect(wakeIndicatorLayout(base).visible).toBe(true);
    expect(wakeIndicatorLayout({ ...base, slow: false }).visible).toBe(false);
  });

  it("sits on the toast offset when no toast is visible", () => {
    expect(wakeIndicatorLayout({ ...base, toastHeight: 120 }).raiseBy).toBe(0);
  });

  it("is raised by the measured toast height + gap (1, 2 or 3 lines)", () => {
    for (const height of [44, 64, 86]) {
      expect(wakeIndicatorLayout({ ...base, toastVisible: true, toastHeight: height }).raiseBy).toBe(height + WAKE_TOAST_GAP_PX);
    }
  });

  it("uses a one-line fallback until the toast has been measured", () => {
    expect(wakeIndicatorLayout({ ...base, toastVisible: true, toastHeight: 0 }).raiseBy).toBe(
      FALLBACK_TOAST_HEIGHT_PX + WAKE_TOAST_GAP_PX
    );
  });

  it("stands down while a modal dialog or bottom sheet is open (its Save button says it instead)", () => {
    expect(wakeIndicatorLayout({ ...base, modalOpen: true }).visible).toBe(false);
  });
});
