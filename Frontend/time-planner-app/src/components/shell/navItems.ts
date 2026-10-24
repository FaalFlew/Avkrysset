// src/components/shell/navItems.ts — primary navigation per workspace (sidebar, rail, tab bar,
// More sheet, hotkeys 1–4).
//
// The workspace ("context") comes from the URL: /orgs/:orgId/… is that organization, everything
// else is Personal. Every role sees the same org pages (each renders role-specific content).
// Hotkeys 1–4 and the phone tab bar use the first four items of the current workspace; the rest
// go into the More sheet.

import type { Component } from "vue";
import {
  Activity,
  CalendarCheck,
  CalendarDays,
  ChartColumn,
  SquareKanban,
  LayoutTemplate,
  Settings,
  Users,
} from "lucide-vue-next";

export interface NavItem {
  /** Route path. */
  to: string;
  /** Route name (matches router/index.ts). */
  name: string;
  label: string;
  icon: Component;
  /** Single-key shortcut ("1".."4") for the first four items of a workspace. */
  shortcut?: string;
}

export type WorkspaceContext = { kind: "personal" } | { kind: "org"; orgId: string };

export const PERSONAL_CONTEXT: WorkspaceContext = { kind: "personal" };

/** How many items get a tab and a 1–4 hotkey. */
export const PRIMARY_COUNT = 4;

/** Personal workspace (also the guest nav). */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", name: "Planner", label: "Planner", icon: CalendarDays, shortcut: "1" },
  { to: "/today", name: "Today", label: "Today", icon: CalendarCheck, shortcut: "2" },
  { to: "/analytics", name: "Analytics", label: "Analytics", icon: ChartColumn, shortcut: "3" },
  { to: "/templates", name: "Templates", label: "Templates", icon: LayoutTemplate, shortcut: "4" },
];

/** Org pages: [path segment, route name, label, icon]. */
const ORG_PAGES: readonly [string, string, string, Component][] = [
  ["schedule", "OrgSchedule", "Schedule", CalendarDays],
  ["board", "OrgBoard", "Board", SquareKanban],
  ["analytics", "OrgAnalytics", "Analytics", ChartColumn],
  ["members", "OrgMembers", "Members", Users],
  ["activity", "OrgActivity", "Activity", Activity],
  ["settings", "OrgSettings", "Settings", Settings],
];

/** Route names of the org pages (router + shell). */
export const ORG_ROUTE_NAMES: readonly string[] = ORG_PAGES.map(([, name]) => name);

export function orgPagePath(orgId: string, segment = "schedule"): string {
  return `/orgs/${orgId}/${segment}`;
}

/** The navigation of a workspace, in order; the first four carry the 1–4 shortcuts. */
export function navItemsFor(context: WorkspaceContext): NavItem[] {
  if (context.kind === "personal") return [...NAV_ITEMS];
  return ORG_PAGES.map(([segment, name, label, icon], index) => ({
    to: orgPagePath(context.orgId, segment),
    name,
    label,
    icon,
    shortcut: index < PRIMARY_COUNT ? String(index + 1) : undefined,
  }));
}

/** The workspace a route belongs to (by its `orgId` param). */
export function contextFromParams(params: Record<string, unknown>): WorkspaceContext {
  const raw = params.orgId;
  const orgId = Array.isArray(raw) ? raw[0] : raw;
  return typeof orgId === "string" && orgId ? { kind: "org", orgId } : PERSONAL_CONTEXT;
}

/** Item for hotkey "1".."4" in a workspace (looked up when pressed). */
export function navItemForShortcut(context: WorkspaceContext, key: string): NavItem | undefined {
  return navItemsFor(context).find((item) => item.shortcut === key);
}
