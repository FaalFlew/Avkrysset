// src/composables/useMediaQuery.ts — reactive media queries with one shared listener per query.

import { readonly, ref, type Ref } from "vue";
import { MEDIA } from "@/lib/breakpoints";

const cache = new Map<string, Readonly<Ref<boolean>>>();

/**
 * Reactive `matchMedia(query).matches`. Listeners are shared and live for the app's lifetime,
 * so calling this from many components is cheap.
 */
export function useMediaQuery(query: string): Readonly<Ref<boolean>> {
  const cached = cache.get(query);
  if (cached) return cached;

  const mql = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query) : null;
  const matches = ref<boolean>(mql?.matches ?? false);
  mql?.addEventListener("change", (event) => {
    matches.value = event.matches;
  });

  const result = readonly(matches);
  cache.set(query, result);
  return result;
}

export interface Breakpoints {
  /** < 768px: tab bar, single-day planner, bottom sheets */
  isMobile: Readonly<Ref<boolean>>;
  /** 768–1023px */
  isTablet: Readonly<Ref<boolean>>;
  /** ≥ 1024px */
  isDesktop: Readonly<Ref<boolean>>;
  /** ≥ 1280px */
  isWide: Readonly<Ref<boolean>>;
  /** Primary pointer is coarse (touch) */
  isCoarse: Readonly<Ref<boolean>>;
  prefersReducedMotion: Readonly<Ref<boolean>>;
}

let breakpoints: Breakpoints | null = null;

export function useBreakpoint(): Breakpoints {
  breakpoints ??= {
    isMobile: useMediaQuery(MEDIA.mobile),
    isTablet: useMediaQuery(MEDIA.tablet),
    isDesktop: useMediaQuery(MEDIA.desktop),
    isWide: useMediaQuery(MEDIA.wide),
    isCoarse: useMediaQuery(MEDIA.coarse),
    prefersReducedMotion: useMediaQuery(MEDIA.reducedMotion),
  };
  return breakpoints;
}
