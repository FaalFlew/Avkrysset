/**
 * Copy & paste rules (backlog item 3): where Ctrl/⌘+V puts the copy, and that a read-only org task
 * becomes a PERSONAL copy with my own category (the server refuses categories that aren't mine).
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import { atMinutesOfDay } from "../datetime";
import { copyOf, newTaskFromCopy, resolvePasteStart } from "../taskClipboard";

const MONDAY = "2026-10-05";
const TUESDAY = "2026-10-06";

describe("resolvePasteStart", () => {
  const focused = { start: atMinutesOfDay(MONDAY, 9 * 60), duration: 1.5 };

  it("pastes at the slot under the mouse pointer first", () => {
    const target = resolvePasteStart({
      pointerSlot: { day: TUESDAY, minutes: 14 * 60 + 15 },
      focused,
      selectedDay: MONDAY,
      minutesOfDay: 8 * 60,
    });
    expect(target).toEqual({ start: atMinutesOfDay(TUESDAY, 14 * 60 + 15), kind: "pointer" });
  });

  it("without the pointer over the grid, right after the focused task (its end)", () => {
    const target = resolvePasteStart({ pointerSlot: null, focused, selectedDay: TUESDAY, minutesOfDay: 8 * 60 });
    expect(target).toEqual({ start: atMinutesOfDay(MONDAY, 10 * 60 + 30), kind: "afterFocused" });
  });

  it("otherwise at the copied time of day on the selected day", () => {
    const target = resolvePasteStart({ pointerSlot: null, focused: null, selectedDay: TUESDAY, minutesOfDay: 8 * 60 + 45 });
    expect(target).toEqual({ start: atMinutesOfDay(TUESDAY, 8 * 60 + 45), kind: "selectedDay" });
  });
});

describe("copying tasks", () => {
  const categories = [
    { id: "other", name: "Other" },
    { id: "work", name: "Work" },
    { id: "gym", name: "Gym" },
  ];
  const templates = [{ id: "tpl-standup" }];
  const base: Task = {
    id: "t1",
    title: "Standup",
    start: atMinutesOfDay(MONDAY, 9 * 60 + 30),
    duration: 0.25,
    categoryId: "work",
    categoryName: "Work",
    categoryColor: "#2F7FE0",
    templateId: "tpl-standup",
  };
  const readOnlyOrgTask: Task = {
    ...base,
    id: "o1",
    title: "Customer call",
    duration: 1.5,
    categoryId: "admins-sales", // the creator's category, not mine
    templateId: "admins-template",
    organizationId: "org-1",
    organizationName: "Acme",
    capabilities: { canEdit: false, canDelete: false, canReassign: false },
  };
  const start = atMinutesOfDay(TUESDAY, 13 * 60);

  it("a read-only org task becomes a personal task: title + duration, my last-used category, no template", () => {
    const copied = copyOf(readOnlyOrgTask, { categories, templates });
    expect(newTaskFromCopy(copied, start, { categories, lastCategoryId: "gym" })).toEqual({
      title: "Customer call",
      start,
      duration: 1.5,
      categoryId: "gym",
    });
    // No last-used category (or it was deleted): "Other".
    expect(newTaskFromCopy(copied, start, { categories, lastCategoryId: "deleted" })?.categoryId).toBe("other");
  });

  it("an editable task keeps its category and template", () => {
    const copied = copyOf(base, { categories, templates });
    expect(newTaskFromCopy(copied, start, { categories, lastCategoryId: "gym" })).toEqual({
      title: "Standup",
      start,
      duration: 0.25,
      categoryId: "work",
      templateId: "tpl-standup",
    });
  });
});
