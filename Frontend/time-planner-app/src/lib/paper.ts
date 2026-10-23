// src/lib/paper.ts — paper size for PDF exports and printing: A4, or US Letter where Letter is
// the norm (same region list as the server). Users can
// override the locale default in the Export menu; the override persists in localStorage.

import { computed, ref, type ComputedRef, type Ref } from "vue";

export type PaperSize = "A4" | "Letter";

export const PAPER_SIZES: readonly PaperSize[] = ["A4", "Letter"];

/**
 * Regions that use US Letter (CLDR paper-size data + DO); everything else uses A4. Keep in sync with
 * the server's `ReportLocale.LetterRegions` (TimePlanner.API/Features/Reports/ReportLocale.cs).
 */
export const LETTER_REGIONS: ReadonlySet<string> = new Set([
  "US", "CA", "MX", "PH", "CL", "CO", "VE", "GT", "CR", "PA", "DO", "PR", "SV", "NI", "BZ",
]);

export const PAPER_STORAGE_KEY = "tp-export-paper";

/** Region of a BCP-47 locale, filling in the likely region ("en" → "US", "nb" → "NO"). */
export function regionOfLocale(locale: string | null | undefined): string | null {
  if (!locale) return null;
  try {
    return new Intl.Locale(locale).maximize().region ?? null;
  } catch {
    return null;
  }
}

/** Default paper for a locale: Letter in {@link LETTER_REGIONS}, A4 otherwise (and when unknown). */
export function paperForLocale(locale: string | null | undefined): PaperSize {
  const region = regionOfLocale(locale);
  return region && LETTER_REGIONS.has(region.toUpperCase()) ? "Letter" : "A4";
}

export function isPaperSize(value: unknown): value is PaperSize {
  return value === "A4" || value === "Letter";
}

/** The browser's preferred locale (BCP-47), e.g. "nb-NO"; "en-US" when unavailable. */
export function browserLocale(): string {
  return (typeof navigator !== "undefined" && navigator.language) || "en-US";
}

function readOverride(): PaperSize | null {
  try {
    const stored = globalThis.localStorage?.getItem(PAPER_STORAGE_KEY);
    return isPaperSize(stored) ? stored : null;
  } catch {
    return null; // storage blocked (private mode, sandboxed iframe)
  }
}

function writeOverride(value: PaperSize | null): void {
  try {
    if (value) globalThis.localStorage?.setItem(PAPER_STORAGE_KEY, value);
    else globalThis.localStorage?.removeItem(PAPER_STORAGE_KEY);
  } catch {
    /* storage unavailable: the choice still applies for this session */
  }
}

export interface PaperPreference {
  /** What exports and printing use: the override, else the locale default. */
  paper: ComputedRef<PaperSize>;
  /** Paper of the browser locale. */
  localeDefault: ComputedRef<PaperSize>;
  /** The user's explicit choice, or null to follow the locale. */
  override: Readonly<Ref<PaperSize | null>>;
  /** Choose a paper size; choosing the locale default clears the override. */
  setPaper: (paper: PaperSize) => void;
}

let preference: PaperPreference | null = null;

/** App-wide paper preference (singleton). */
export function usePaperPreference(): PaperPreference {
  if (preference) return preference;
  const override = ref<PaperSize | null>(readOverride());
  const locale = ref(browserLocale());
  const localeDefault = computed(() => paperForLocale(locale.value));
  const paper = computed(() => override.value ?? localeDefault.value);
  preference = {
    paper,
    localeDefault,
    override,
    setPaper(next: PaperSize) {
      override.value = next === localeDefault.value ? null : next;
      writeOverride(override.value);
    },
  };
  return preference;
}

/** Test hook: forget the singleton (re-reads storage and locale on next use). */
export function resetPaperPreferenceForTests(): void {
  preference = null;
}
