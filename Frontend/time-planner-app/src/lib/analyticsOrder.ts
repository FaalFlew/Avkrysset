// src/lib/analyticsOrder.ts — the one ordering of categories and templates in analytics, shared
// with the server (GetTaskAnalytics + the report builder), so the page, the CSV and the PDF agree:
//   hours DESC, then name by ORDINAL comparison (UTF-16 code units — plain `<`, never
//   localeCompare), then id (ordinal). "Without template" is always last (it is kept apart from
//   the template list); the top category is the first category in this order.

/** Ordinal (UTF-16 code unit) string comparison, like .NET `StringComparer.Ordinal`. */
export function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface RankedItem {
  id: string;
  name: string;
  hours: number;
}

/** Sort comparator: hours descending, then name, then id (both ordinal). */
export function compareByHoursThenName(a: RankedItem, b: RankedItem): number {
  if (a.hours !== b.hours) return a.hours > b.hours ? -1 : 1;
  return ordinalCompare(a.name, b.name) || ordinalCompare(a.id, b.id);
}

/** A sorted copy (see {@link compareByHoursThenName}). */
export function rankByHours<T extends RankedItem>(items: readonly T[]): T[] {
  return [...items].sort(compareByHoursThenName);
}
