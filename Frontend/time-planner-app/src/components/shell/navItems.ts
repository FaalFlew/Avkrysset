// src/components/shell/navItems.ts — primary navigation (sidebar, rail, tab bar, hotkeys 1–4).

import type { Component } from "vue";
import { CalendarCheck, CalendarDays, ChartColumn, LayoutTemplate } from "lucide-vue-next";

export interface NavItem {
  /** Route path. */
  to: string;
  /** Route name (matches router/index.ts). */
  name: string;
  label: string;
  icon: Component;
  /** Single-key shortcut ("1".."4"). */
  shortcut: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", name: "Planner", label: "Planner", icon: CalendarDays, shortcut: "1" },
  { to: "/today", name: "Today", label: "Today", icon: CalendarCheck, shortcut: "2" },
  { to: "/analytics", name: "Analytics", label: "Analytics", icon: ChartColumn, shortcut: "3" },
  { to: "/templates", name: "Templates", label: "Templates", icon: LayoutTemplate, shortcut: "4" },
];
