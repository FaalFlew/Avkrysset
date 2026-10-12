/** The ordering shared with the server: hours DESC, then name, then id — both ordinal. */
import { describe, expect, it } from "vitest";
import { compareByHoursThenName, ordinalCompare, rankByHours } from "../analyticsOrder";

describe("ordinalCompare", () => {
  it("compares UTF-16 code units, not locale collation", () => {
    expect(ordinalCompare("Zeta", "beta")).toBeLessThan(0); // "Z" 0x5A < "b" 0x62
    expect("Zeta".localeCompare("beta")).toBeGreaterThan(0); // what we must NOT do
    expect(ordinalCompare("Å", "B")).toBeGreaterThan(0); // "Å" 0xC5 > "B" 0x42
    expect(ordinalCompare("a", "a")).toBe(0);
    expect(ordinalCompare("", "a")).toBeLessThan(0);
    expect(ordinalCompare("😀", "￿")).toBeLessThan(0); // surrogate 0xD83D < 0xFFFF (UTF-16 order)
  });
});

describe("rankByHours", () => {
  it("orders by hours DESC first", () => {
    const ranked = rankByHours([
      { id: "a", name: "A", hours: 1 },
      { id: "b", name: "B", hours: 3 },
      { id: "c", name: "C", hours: 2 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks equal hours by name, then identical names by id", () => {
    const ranked = rankByHours([
      { id: "x2", name: "work", hours: 2 },
      { id: "x9", name: "Work", hours: 2 },
      { id: "x1", name: "Work", hours: 2 },
      { id: "x0", name: "Écrire", hours: 2 },
      { id: "x5", name: "Zoo", hours: 2 },
    ]);
    expect(ranked.map((r) => `${r.name}#${r.id}`)).toEqual(["Work#x1", "Work#x9", "Zoo#x5", "work#x2", "Écrire#x0"]);
  });

  it("does not mutate the input and is independent of the input order", () => {
    const items = [
      { id: "b", name: "Same", hours: 1 },
      { id: "a", name: "Same", hours: 1 },
    ];
    const copy = [...items];
    expect(rankByHours(items).map((r) => r.id)).toEqual(["a", "b"]);
    expect(rankByHours([...items].reverse()).map((r) => r.id)).toEqual(["a", "b"]);
    expect(items).toEqual(copy);
    expect(compareByHoursThenName(items[0]!, items[0]!)).toBe(0);
  });
});
