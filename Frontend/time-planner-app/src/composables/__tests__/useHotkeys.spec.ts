/** Which focus targets let the planner's ←/→ week navigation through. */
import { describe, expect, it } from "vitest";
import { isNeutralTarget } from "../useHotkeys";

function fakeElement(attributes: Record<string, string>, id = ""): EventTarget {
  return {
    id,
    hasAttribute: (name: string) => name in attributes,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  } as unknown as EventTarget;
}

describe("isNeutralTarget", () => {
  it("accepts the page itself", () => {
    expect(isNeutralTarget(null)).toBe(true);
    expect(isNeutralTarget(fakeElement({}, "main"))).toBe(true);
  });

  it("accepts the page heading that route changes focus (L1)", () => {
    expect(isNeutralTarget(fakeElement({ "data-page-heading": "" }))).toBe(true);
  });

  it("accepts opted-in elements such as the grid scroller", () => {
    expect(isNeutralTarget(fakeElement({ "data-hotkey-arrows": "" }))).toBe(true);
  });

  it("rejects other controls (task blocks, radiogroups, the date picker)", () => {
    expect(isNeutralTarget(fakeElement({ "data-task-id": "t1" }))).toBe(false);
    expect(isNeutralTarget(fakeElement({ role: "radio" }))).toBe(false);
  });
});
