/** Paper size: locale default (CLDR Letter regions) and the persisted override. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAPER_STORAGE_KEY,
  paperForLocale,
  regionOfLocale,
  resetPaperPreferenceForTests,
  usePaperPreference,
} from "../paper";

describe("paperForLocale", () => {
  it("uses Letter in the US, Canada, Mexico, the Philippines, Chile, Colombia, …", () => {
    for (const locale of ["en-US", "en-CA", "fr-CA", "es-MX", "en-PH", "fil-PH", "es-CL", "es-CO", "es-VE", "es-PR", "es-DO"]) {
      expect(paperForLocale(locale), locale).toBe("Letter");
    }
  });

  it("uses A4 everywhere else", () => {
    for (const locale of ["nb-NO", "en-GB", "de-DE", "fr-FR", "es-ES", "pt-BR", "ja-JP", "ar-EG", "en-AU", "hi-IN"]) {
      expect(paperForLocale(locale), locale).toBe("A4");
    }
  });

  it("fills in the likely region of a bare language", () => {
    expect(regionOfLocale("en")).toBe("US");
    expect(paperForLocale("en")).toBe("Letter");
    expect(regionOfLocale("nb")).toBe("NO");
    expect(paperForLocale("nb")).toBe("A4");
    expect(paperForLocale("de")).toBe("A4");
  });

  it("falls back to A4 for missing or invalid locales", () => {
    expect(paperForLocale(undefined)).toBe("A4");
    expect(paperForLocale(null)).toBe("A4");
    expect(paperForLocale("")).toBe("A4");
    expect(paperForLocale("not a locale!")).toBe("A4");
  });
});

describe("usePaperPreference", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal("navigator", { language: "nb-NO" });
    resetPaperPreferenceForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetPaperPreferenceForTests();
  });

  it("defaults to the locale's paper", () => {
    const { paper, localeDefault, override } = usePaperPreference();
    expect(localeDefault.value).toBe("A4");
    expect(paper.value).toBe("A4");
    expect(override.value).toBeNull();
  });

  it("persists an override and clears it when the locale default is chosen again", () => {
    const pref = usePaperPreference();
    pref.setPaper("Letter");
    expect(pref.paper.value).toBe("Letter");
    expect(store.get(PAPER_STORAGE_KEY)).toBe("Letter");

    resetPaperPreferenceForTests();
    expect(usePaperPreference().paper.value).toBe("Letter"); // read back from storage

    usePaperPreference().setPaper("A4");
    expect(usePaperPreference().paper.value).toBe("A4");
    expect(store.has(PAPER_STORAGE_KEY)).toBe(false);
  });

  it("ignores junk in storage", () => {
    store.set(PAPER_STORAGE_KEY, "Tabloid");
    expect(usePaperPreference().paper.value).toBe("A4");
  });

  it("keeps working when storage throws (private mode)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });
    resetPaperPreferenceForTests();
    const pref = usePaperPreference();
    expect(pref.paper.value).toBe("A4");
    expect(() => pref.setPaper("Letter")).not.toThrow();
    expect(pref.paper.value).toBe("Letter");
  });

  it("is Letter by default for en-US", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    resetPaperPreferenceForTests();
    expect(usePaperPreference().paper.value).toBe("Letter");
  });
});
