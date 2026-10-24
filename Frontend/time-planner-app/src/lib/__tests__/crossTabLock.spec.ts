/** src/lib/crossTabLock.ts: Web Locks when available (tasks take turns), plain call otherwise. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { crossTabLocks, withCrossTabLock } from "../crossTabLock";
import { FakeLocks } from "@/services/__tests__/fakeApi";

afterEach(() => vi.unstubAllGlobals());

describe("withCrossTabLock", () => {
  it("runs tasks one after the other under navigator.locks", async () => {
    const locks = new FakeLocks();
    vi.stubGlobal("navigator", { locks });
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = withCrossTabLock("l", async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => (releaseFirst = resolve));
      order.push("first:end");
      return 1;
    });
    const second = withCrossTabLock("l", async () => {
      order.push("second");
      return 2;
    });
    await Promise.resolve();
    await Promise.resolve();
    releaseFirst();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
    expect(locks.requests).toBe(2);
  });

  it("passes the task's rejection through (and releases the lock)", async () => {
    vi.stubGlobal("navigator", { locks: new FakeLocks() });
    await expect(withCrossTabLock("l", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(withCrossTabLock("l", async () => "next")).resolves.toBe("next");
  });

  it("falls back to a plain call without the Web Locks API", async () => {
    for (const navigator of [{}, { locks: {} }, undefined]) {
      vi.stubGlobal("navigator", navigator);
      expect(crossTabLocks()).toBeNull();
      await expect(withCrossTabLock("l", async () => "ran")).resolves.toBe("ran");
    }
  });
});
