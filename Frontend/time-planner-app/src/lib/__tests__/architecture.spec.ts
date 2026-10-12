/**
 * Architecture guard: `src/lib/datetime.ts` is the only place allowed to touch raw datetime
 * APIs. Everything else must go through its primitive-based helpers, so time-zone semantics
 * live in exactly one module. `Date.now()` stays allowed (timestamps for ids, debounce, …).
 * Comment lines are not checked.
 */
import { describe, expect, it } from "vitest";

const sources = import.meta.glob<string>("/src/**/*.{ts,vue}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const stray = import.meta.glob<string>("/src/**/*.{js,jsx,mjs,cjs}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const HELPER = "/src/lib/datetime.ts";
const isTestFile = (path: string) =>
  path.includes("/__tests__/") || /\.(spec|test)\.ts$/.test(path);

const RULES: { name: string; pattern: RegExp }[] = [
  {
    name: 'imports dayjs (use "@/lib/datetime")',
    pattern: /\bfrom\s*["']dayjs(?:\/[^"']*)?["']|\b(?:import|require)\s*\(\s*["']dayjs/,
  },
  { name: "constructs a Date (`new Date`)", pattern: /\bnew\s+Date\b/ },
  { name: "calls .toISOString()", pattern: /\.toISOString\s*\(/ },
  { name: "parses with Date.parse()", pattern: /\bDate\.parse\s*\(/ },
  { name: "builds instants with Date.UTC()", pattern: /\bDate\.UTC\s*\(/ },
  {
    name: "formats with .toLocaleDateString() / .toLocaleTimeString()",
    pattern: /\.toLocale(?:Date|Time)String\s*\(/,
  },
  {
    // Numbers have toLocaleString() too, so only date-looking calls are flagged: a receiver
    // named like a date, or date/time formatting options in the call.
    name: "formats a date with .toLocaleString()",
    pattern:
      /\b\w*(?:date|time|day|instant|moment)\w*(?:\(\))?\s*\.toLocaleString\s*\(|\.toLocaleString\s*\([^)]*\b(?:timeZone|weekday|hour|minute|second|month|dateStyle|timeStyle)\b/i,
  },
  {
    name: "formats with Intl.DateTimeFormat / Intl.RelativeTimeFormat",
    pattern: /\bIntl\s*\.\s*(?:DateTimeFormat|RelativeTimeFormat)\b/,
  },
];

const isCommentLine = (line: string) => /^\s*(?:\/\/|\/\*|\*|<!--)/.test(line);

function violationsIn(code: string): { line: number; rule: string; text: string }[] {
  const found: { line: number; rule: string; text: string }[] = [];
  code.split(/\r?\n/).forEach((line, index) => {
    if (isCommentLine(line)) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line)) found.push({ line: index + 1, rule: rule.name, text: line.trim() });
    }
  });
  return found;
}

describe("datetime architecture", () => {
  const checked = Object.entries(sources).filter(
    ([path]) => path !== HELPER && !isTestFile(path)
  );

  it("finds the source files", () => {
    expect(sources[HELPER]).toBeTypeOf("string");
    expect(checked.length).toBeGreaterThan(10);
  });

  it("keeps raw datetime APIs inside src/lib/datetime.ts", () => {
    const violations = checked.flatMap(([path, code]) =>
      violationsIn(code).map((v) => `${path}:${v.line} ${v.rule}: ${v.text}`)
    );
    expect(violations).toEqual([]);
  });

  it("flags raw datetime calls but not number formatting or Date.now()", () => {
    const flagged = [
      'import dayjs from "dayjs";',
      "const d = new Date();",
      "x.toISOString()",
      "Date.parse(value)",
      "Date.UTC(2026, 0, 1)",
      "start.toLocaleDateString()",
      "d.toLocaleTimeString([], { hour: '2-digit' })",
      "startDate.toLocaleString()",
      "value.toLocaleString(undefined, { hour: 'numeric' })",
      "new Intl.DateTimeFormat(undefined, { month: 'long' })",
      "const rtf = new Intl.RelativeTimeFormat('en');",
    ];
    for (const line of flagged) expect(violationsIn(line), line).not.toEqual([]);

    const allowed = [
      "const id = Date.now();",
      "count.toLocaleString()",
      "(1234.5).toLocaleString(undefined, { maximumFractionDigits: 1 })",
      "new Intl.NumberFormat(undefined, { style: 'percent' })",
      "// e.g. new Date() or Intl.DateTimeFormat in a comment",
      " * Uses Date.parse() semantics",
    ];
    for (const line of allowed) expect(violationsIn(line), line).toEqual([]);
  });

  it("has no compiled .js files shadowing the TypeScript sources", () => {
    expect(Object.keys(stray)).toEqual([]);
  });
});
