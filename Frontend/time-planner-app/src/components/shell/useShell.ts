// src/components/shell/useShell.ts — app-shell state shared by the sidebar, rail, drawer,
// tab bar and hotkeys (module-level singleton).
//
// Sidebar modes by width:
//   < 768      hidden (bottom tab bar instead)
//   768–1023   rail; the expand button opens the expanded sidebar as an overlay drawer
//   ≥ 1024     rail or expanded, user-toggleable ("[" key), persisted in localStorage "tp-sidebar";
//              default: expanded at ≥ 1280, rail at 1024–1279

import { computed, ref } from "vue";
import type { Router } from "vue-router";
import { useBreakpoint } from "@/composables/useMediaQuery";
import { useAuthStore } from "@/stores/authStore";
import { useTaskStore } from "@/stores/taskStore";

export type SidebarMode = "hidden" | "rail" | "expanded";
type SidebarPref = "expanded" | "collapsed";

const STORAGE_KEY = "tp-sidebar";

function readPref(): SidebarPref | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "expanded" || value === "collapsed" ? value : null;
  } catch {
    return null;
  }
}

const pref = ref<SidebarPref | null>(readPref());
const drawerOpen = ref(false);
const moreSheetOpen = ref(false);

export function useShell() {
  const { isMobile, isTablet, isWide } = useBreakpoint();

  const sidebarMode = computed<SidebarMode>(() => {
    if (isMobile.value) return "hidden";
    if (isTablet.value) return "rail";
    if (pref.value) return pref.value === "expanded" ? "expanded" : "rail";
    return isWide.value ? "expanded" : "rail";
  });

  /** Collapse/expand at ≥ 1024 (persisted); open/close the drawer at 768–1023. */
  function toggleSidebar(): void {
    if (isMobile.value) return;
    if (isTablet.value) {
      drawerOpen.value = !drawerOpen.value;
      return;
    }
    pref.value = sidebarMode.value === "expanded" ? "collapsed" : "expanded";
    try {
      localStorage.setItem(STORAGE_KEY, pref.value);
    } catch {
      /* storage unavailable: the choice lasts for this session */
    }
  }

  return {
    sidebarMode,
    drawerOpen,
    moreSheetOpen,
    toggleSidebar,
    closeDrawer: () => {
      drawerOpen.value = false;
    },
  };
}

/** Log out, switch the store back to guest data and go to the login page. */
export async function logoutAndRedirect(router: Router): Promise<void> {
  const authStore = useAuthStore();
  const taskStore = useTaskStore();
  await authStore.logout();
  await taskStore.initializeData();
  await router.push("/login");
}
