// src/composables/useTheme.ts — app theme (light / dark / follow system). Module-level singleton.
//
// The pre-paint script in index.html applies the stored theme before CSS loads; initTheme()
// (called once in main.ts) takes over from there: it keeps <html data-theme> and
// `color-scheme` in sync, updates <meta name="theme-color">, follows the OS setting while in
// "system" mode, and syncs across tabs through the storage event.

import { computed, readonly, ref, type ComputedRef, type Ref } from "vue";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "tp-theme";
export const THEME_MODES: readonly ThemeMode[] = ["light", "dark", "system"];

/** Must match --bg-app in tokens.css (used for the browser UI color). */
const THEME_COLORS: Record<ResolvedTheme, string> = { light: "#FFFFFF", dark: "#141416" };

function parseMode(value: string | null | undefined): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function readStoredMode(): ThemeMode {
  try {
    return parseMode(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const mode = ref<ThemeMode>(typeof window === "undefined" ? "system" : readStoredMode());
const systemDark = ref<boolean>(systemPrefersDark());
const resolvedTheme = computed<ResolvedTheme>(() =>
  mode.value === "system" ? (systemDark.value ? "dark" : "light") : mode.value,
);

let initialized = false;
let lastApplied: ResolvedTheme | null = null;

function applyTheme(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const theme = resolvedTheme.value;

  // Swap colors instantly instead of running every hover/color transition at once.
  const changed = lastApplied !== null && lastApplied !== theme;
  if (changed) root.classList.add("theme-switching");

  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  lastApplied = theme;

  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    if (mode.value === "system" && meta.media) {
      meta.content = meta.media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light;
    } else {
      meta.content = THEME_COLORS[theme];
    }
  });

  if (changed) {
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
  }
}

/** Call once at startup (main.ts). Safe to call more than once. */
export function initTheme(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  mode.value = readStoredMode();
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (media) {
    systemDark.value = media.matches;
    media.addEventListener("change", (event) => {
      systemDark.value = event.matches;
      if (mode.value === "system") applyTheme();
    });
  }

  // Keep several open tabs in sync.
  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    mode.value = parseMode(event.newValue);
    applyTheme();
  });

  applyTheme();
}

function setMode(next: ThemeMode): void {
  mode.value = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* storage unavailable (private mode): theme still applies for this session */
  }
  applyTheme();
}

/** light → dark → system → light */
function cycleMode(): void {
  const index = THEME_MODES.indexOf(mode.value);
  setMode(THEME_MODES[(index + 1) % THEME_MODES.length]!);
}

export interface UseTheme {
  /** The user's choice (persisted in localStorage "tp-theme"). */
  mode: Readonly<Ref<ThemeMode>>;
  /** What is actually painted right now. */
  resolvedTheme: ComputedRef<ResolvedTheme>;
  setMode: (mode: ThemeMode) => void;
  cycleMode: () => void;
}

const api: UseTheme = {
  mode: readonly(mode),
  resolvedTheme,
  setMode,
  cycleMode,
};

export function useTheme(): UseTheme {
  return api;
}
