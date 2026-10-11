/**
 * Print mode with a minimal fake DOM (the test environment is node): light theme forced and
 * restored, "View data" tables expanded and collapsed again, charts redrawn at 2× (fixed print
 * size when declared), @page size from the paper, beforeprint/afterprint, iOS fallback exit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

type Listener = (event?: unknown) => void;

function fakeClassList() {
  const set = new Set<string>();
  return {
    set,
    add: (...names: string[]) => names.forEach((n) => set.add(n)),
    remove: (...names: string[]) => names.forEach((n) => set.delete(n)),
    contains: (name: string) => set.has(name),
  };
}

function fakeDom(storedTheme: string | null) {
  const root = { classList: fakeClassList(), dataset: { theme: "dark" } as Record<string, string>, style: { colorScheme: "dark" } };
  const details = [{ open: false }, { open: true }, { open: false }];
  const elements = new Map<string, { id: string; media: string; textContent: string; remove: () => void }>();
  const document = {
    documentElement: root,
    querySelectorAll: (selector: string) => {
      expect(selector).toBe("details[data-print-expand]:not([open])");
      return details.filter((d) => !d.open);
    },
    getElementById: (id: string) => elements.get(id) ?? null,
    createElement: (tag: string) => {
      expect(tag).toBe("style");
      const el = {
        id: "",
        media: "",
        textContent: "",
        remove: () => elements.delete(el.id),
      };
      return el;
    },
    head: { appendChild: (el: { id: string; media: string; textContent: string; remove: () => void }) => elements.set(el.id, el) },
  };
  const listeners = new Map<string, Set<Listener>>();
  const mediaListeners = new Set<Listener>();
  const window = {
    addEventListener: (type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => listeners.get(type)?.delete(fn),
    matchMedia: () => ({
      matches: false,
      addEventListener: (_: string, fn: Listener) => mediaListeners.add(fn),
      removeEventListener: (_: string, fn: Listener) => mediaListeners.delete(fn),
    }),
    print: vi.fn(),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  };
  const fire = (type: string) => [...(listeners.get(type) ?? [])].forEach((fn) => fn());
  const storage = new Map<string, string>(storedTheme ? [["tp-theme", storedTheme]] : []);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
  return { root, details, elements, window, fire, listeners, mediaListeners };
}

function fakeChart(printSize: string | null) {
  return {
    options: {} as { devicePixelRatio?: number },
    stop: vi.fn(),
    update: vi.fn(),
    resize: vi.fn(),
    canvas: { closest: () => (printSize ? { dataset: { printSize } } : null) },
  };
}

async function load() {
  vi.resetModules();
  const mod = await import("../usePrintMode");
  const { Chart } = await import("chart.js");
  const instances = Chart.instances as unknown as Record<string, ReturnType<typeof fakeChart>>;
  for (const key of Object.keys(instances)) delete instances[key];
  const bar = fakeChart("680x260");
  const donut = fakeChart(null);
  instances.bar = bar;
  instances.donut = donut;
  return { mod, bar, donut };
}

const settle = async () => {
  await nextTick();
  await nextTick();
  await nextTick();
};

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePrintMode", () => {
  it("enter: light theme, expanded tables, charts at 2× (fixed print size); exit restores", async () => {
    const dom = fakeDom("dark");
    const { mod, bar, donut } = await load();

    mod.enterPrintMode();
    expect(mod.printState.active).toBe(true);
    expect(dom.root.dataset.theme).toBe("light");
    expect(dom.root.style.colorScheme).toBe("light");
    expect(dom.root.classList.contains("is-printing")).toBe(true);
    expect(dom.root.classList.contains("theme-switching")).toBe(true);
    expect(dom.details.map((d) => d.open)).toEqual([true, true, true]);

    await settle();
    expect(bar.options.devicePixelRatio).toBe(mod.PRINT_DEVICE_PIXEL_RATIO);
    expect(mod.PRINT_DEVICE_PIXEL_RATIO).toBe(2);
    expect(bar.stop).toHaveBeenCalled();
    expect(bar.update).toHaveBeenCalledWith("none");
    expect(bar.resize).toHaveBeenLastCalledWith(680, 260);
    expect(donut.resize).toHaveBeenLastCalledWith();

    mod.enterPrintMode(); // idempotent
    expect(dom.details.map((d) => d.open)).toEqual([true, true, true]);

    mod.exitPrintMode();
    expect(mod.printState.active).toBe(false);
    expect(dom.root.dataset.theme).toBe("dark"); // the user's theme (tp-theme = dark)
    expect(dom.root.style.colorScheme).toBe("dark");
    expect(dom.root.classList.contains("is-printing")).toBe(false);
    // only the tables print mode opened are closed again
    expect(dom.details.map((d) => d.open)).toEqual([false, true, false]);

    await settle();
    expect(bar.options.devicePixelRatio).toBeUndefined();
    expect(bar.resize).toHaveBeenLastCalledWith();
    await new Promise((r) => setTimeout(r, 400));
    expect(dom.root.classList.contains("theme-switching")).toBe(false);
  });

  it("stamps the generated-at time when print mode starts", async () => {
    fakeDom(null);
    const { mod } = await load();
    const before = mod.printState.printedAt;
    await new Promise((r) => setTimeout(r, 5));
    mod.enterPrintMode();
    expect(mod.printState.printedAt).toBeGreaterThan(before);
    mod.exitPrintMode();
  });

  it("installPrintSupport: @page size follows the paper; beforeprint/afterprint toggle print mode", async () => {
    const dom = fakeDom("light");
    const { mod } = await load();
    const paper = ref<"A4" | "Letter">("A4");
    const uninstall = mod.installPrintSupport(() => paper.value);

    const style = dom.elements.get("tp-print-page")!;
    expect(style.media).toBe("print");
    expect(style.textContent).toBe("@page { size: A4 portrait; margin: 14mm; }");
    paper.value = "Letter";
    await nextTick();
    expect(style.textContent).toBe("@page { size: letter portrait; margin: 14mm; }");

    dom.fire("beforeprint");
    expect(mod.printState.active).toBe(true);
    dom.fire("afterprint");
    expect(mod.printState.active).toBe(false);

    // the print media query is a backup signal
    [...dom.mediaListeners].forEach((fn) => fn({ matches: true }));
    expect(mod.printState.active).toBe(true);
    [...dom.mediaListeners].forEach((fn) => fn({ matches: false }));
    expect(mod.printState.active).toBe(false);

    dom.fire("beforeprint");
    uninstall(); // leaving the page ends print mode and removes everything
    expect(mod.printState.active).toBe(false);
    expect(dom.elements.has("tp-print-page")).toBe(false);
    expect(dom.listeners.get("beforeprint")?.size ?? 0).toBe(0);
    expect(dom.listeners.get("afterprint")?.size ?? 0).toBe(0);
    expect(dom.mediaListeners.size).toBe(0);
  });

  it("printReport: prepares (charts redrawn) before window.print(), then exits on the next interaction (iOS)", async () => {
    const dom = fakeDom("dark");
    const { mod, bar } = await load();
    dom.window.print.mockImplementation(() => {
      // what the browser prints
      expect(mod.printState.active).toBe(true);
      expect(dom.root.dataset.theme).toBe("light");
      expect(bar.resize).toHaveBeenCalledWith(680, 260);
    });

    await mod.printReport();
    expect(dom.window.print).toHaveBeenCalledTimes(1);
    // iOS: print() returned at once and no afterprint came; still printing until the user interacts
    expect(mod.printState.active).toBe(true);
    await new Promise((r) => setTimeout(r, 550));
    dom.fire("pointerdown");
    expect(mod.printState.active).toBe(false);
    expect(dom.root.dataset.theme).toBe("dark");
  });

  it("printReport: desktop afterprint during print() leaves nothing armed", async () => {
    const dom = fakeDom(null);
    const { mod } = await load();
    dom.window.print.mockImplementation(() => mod.exitPrintMode()); // blocking print + afterprint
    await mod.printReport();
    expect(mod.printState.active).toBe(false);
    await new Promise((r) => setTimeout(r, 550));
    expect(dom.listeners.get("pointerdown")?.size ?? 0).toBe(0);
  });

  it("pageRule", async () => {
    fakeDom(null);
    const { mod } = await load();
    expect(mod.pageRule("A4")).toBe("@page { size: A4 portrait; margin: 14mm; }");
    expect(mod.pageRule("Letter")).toBe("@page { size: letter portrait; margin: 14mm; }");
  });
});
