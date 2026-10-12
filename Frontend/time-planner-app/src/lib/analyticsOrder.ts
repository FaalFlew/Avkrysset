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

/**
 * Hours as compared for ordering: rounded to 6 decimals (like the server's `AnalyticsOrder.HoursKey`),
 * so floating-point sums don't break ties — 0.1 + 0.1 + 0.1 must tie with 0.3.
 */
export function hoursKey(hours: number): number {
  return Number.isFinite(hours) ? Math.round(hours * 1e6) / 1e6 : 0;
}

/** Sort comparator: hours descending (see {@link hoursKey}), then name, then id (both ordinal). */
export function compareByHoursThenName(a: RankedItem, b: RankedItem): number {
  const ha = hoursKey(a.hours);
  const hb = hoursKey(b.hours);
  if (ha !== hb) return ha > hb ? -1 : 1;
  return ordinalCompare(a.name, b.name) || ordinalCompare(a.id, b.id);
}

/** A sorted copy (see {@link compareByHoursThenName}). */
export function rankByHours<T extends RankedItem>(items: readonly T[]): T[] {
  return [...items].sort(compareByHoursThenName);
}
