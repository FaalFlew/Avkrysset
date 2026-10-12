// src/lib/format.ts — pure number/text formatting. No dates here (dates go through src/lib/datetime.ts).

const NBSP = " ";

const hoursFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/**
 * Compact duration from hours: 0.25 → "15m", 1 → "1h", 1.5 → "1h 30m", 0 → "0m".
 * Rounds to the nearest minute; negative input is treated as 0.
 */
export function formatDuration(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(finiteOrZero(hours) * 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Hours with one decimal, trailing ".0" trimmed, locale-aware separator:
 * 12.5 → "12.5 h", 3 → "3 h", 2.04 → "2 h". Uses a non-breaking space before "h".
 */
export function formatHours(hours: number): string {
  const rounded = Math.round(finiteOrZero(hours) * 10) / 10;
  return `${hoursFormatter.format(rounded)}${NBSP}h`;
}

/**
 * Ratio (0–1) as a whole percentage: 0.42 → "42%". Values between 0 and 0.5% show "<1%".
 */
export function formatPercent(ratio: number): string {
  const value = finiteOrZero(ratio);
  if (value > 0 && value < 0.005) return `<${percentFormatter.format(0.01)}`;
  return percentFormatter.format(value);
}

/**
 * Count with a noun: pluralize(1, "task") → "1 task", pluralize(3, "category", "categories") → "3 categories".
 */
export function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Natural-language list: ["a"] → "a", ["a","b"] → "a and b", ["a","b","c"] → "a, b and c".
 */
export function joinList(items: readonly string[], conjunction = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}
