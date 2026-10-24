/**
 * Navigation follows the workspace in the URL: the Personal pages everywhere else, the org pages
 * under /orgs/:orgId. Hotkeys 1–4 (and the phone tab bar) are the first four of the current
 * workspace, so "2" opens Today in Personal but the Board in an organization.
 */
import { describe, expect, it } from "vitest";
import { contextFromParams, navItemForShortcut, navItemsFor, PRIMARY_COUNT } from "../navItems";

const ORG = "9f0c2b4e-1d2a-4c3b-8e7f-0a1b2c3d4e5f";

describe("navItemsFor", () => {
  it("lists the personal pages, all with a shortcut", () => {
    const items = navItemsFor({ kind: "personal" });
    expect(items.map((i) => [i.label, i.to, i.shortcut])).toEqual([
      ["Planner", "/", "1"],
      ["Today", "/today", "2"],
      ["Analytics", "/analytics", "3"],
      ["Templates", "/templates", "4"],
    ]);
  });

  it("lists every org page for the org in the URL; only the first four get 1–4", () => {
    const items = navItemsFor({ kind: "org", orgId: ORG });
    expect(items.map((i) => [i.label, i.to, i.shortcut])).toEqual([
      ["Schedule", `/orgs/${ORG}/schedule`, "1"],
      ["Board", `/orgs/${ORG}/board`, "2"],
      ["Analytics", `/orgs/${ORG}/analytics`, "3"],
      ["Members", `/orgs/${ORG}/members`, "4"],
      ["Activity", `/orgs/${ORG}/activity`, undefined],
      ["Settings", `/orgs/${ORG}/settings`, undefined],
    ]);
    expect(items.slice(PRIMARY_COUNT).map((i) => i.label)).toEqual(["Activity", "Settings"]);
  });
});

describe("hotkeys follow the workspace", () => {
  it("resolves 1–4 against the current context", () => {
    const personal = contextFromParams({});
    const org = contextFromParams({ orgId: ORG });
    expect(navItemForShortcut(personal, "2")?.to).toBe("/today");
    expect(navItemForShortcut(org, "2")?.to).toBe(`/orgs/${ORG}/board`);
    expect(navItemForShortcut(org, "4")?.to).toBe(`/orgs/${ORG}/members`);
    expect(navItemForShortcut(org, "5")).toBeUndefined();
  });

  it("reads the org id from route params (string or repeated)", () => {
    expect(contextFromParams({ orgId: [ORG] })).toEqual({ kind: "org", orgId: ORG });
    expect(contextFromParams({ orgId: "" })).toEqual({ kind: "personal" });
  });
});
