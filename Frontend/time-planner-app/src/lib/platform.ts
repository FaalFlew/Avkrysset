// src/lib/platform.ts — tiny platform helpers (no dates).

type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } };

function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as NavigatorWithUAData;
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** True on macOS / iOS (⌘ is the primary modifier). */
export const isMac: boolean = detectMac();

/** Visible label for the primary modifier key: "⌘" on Apple platforms, "Ctrl" elsewhere. */
export const modKeyLabel: string = isMac ? "⌘" : "Ctrl";

/** True when the platform's primary modifier (⌘ on Mac, Ctrl elsewhere) is held. */
export function isModKey(event: KeyboardEvent | MouseEvent): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}
