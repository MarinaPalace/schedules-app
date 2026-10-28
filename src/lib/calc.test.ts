import { describe, expect, it } from "vitest";
import { addDays, addMonths, dateRange, mondayOf, monthBounds } from "./calendar";
import { toDayValue } from "./day-input";
import { parseEurToCents } from "./money";
import { costCents, rateAt } from "./rates";
import { paidMinutes, parseSegments } from "./shifts";

describe("shift hours", () => {
  it("handles split shifts", () => {
    const s = parseSegments("09:00-11:00 / 15:00-20:00")!;
    expect(s).toEqual([
      { start: "09:00", end: "11:00" },
      { start: "15:00", end: "20:00" },
    ]);
    expect(paidMinutes(s)).toBe(7 * 60);
  });

  it("handles overnight shifts and breaks", () => {
    expect(paidMinutes(parseSegments("23:00-07:00")!)).toBe(8 * 60);
    expect(paidMinutes(parseSegments("08:00-16:30")!, 30)).toBe(8 * 60);
  });

  it("accepts short hours and en dash, rejects junk", () => {
    expect(parseSegments("7:00–15:00")).toEqual([{ start: "07:00", end: "15:00" }]);
    expect(parseSegments("lunch")).toBeNull();
    expect(parseSegments("25:00-14:00")).toBeNull();
    expect(parseSegments("10:00-10:00")).toBeNull();
  });
});

describe("day input", () => {
  it("rejects a break longer than the shift", () => {
    expect(toDayValue({ kind: "shift", hours: "08:00-09:00", breakMinutes: 90, absenceCode: null })).toMatch(/Break/);
  });
  it("requires a known absence code", () => {
    expect(toDayValue({ kind: "absence", hours: "", breakMinutes: 0, absenceCode: "X" })).toMatch(/absence/);
    expect(toDayValue({ kind: "absence", hours: "", breakMinutes: 0, absenceCode: "Б" })).toMatchObject({ paidMinutes: 0, absenceCode: "Б" });
  });
});

describe("calendar", () => {
  it("does month and week maths", () => {
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2028-02").to).toBe("2028-02-29");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26"); // Sunday -> previous Monday
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(dateRange("2026-10-24", "2026-10-26")).toHaveLength(3); // across the DST change
  });
});

describe("rates and money", () => {
  const book = { e1: [{ from: "2026-01-01", cents: 700 }, { from: "2026-07-01", cents: 800 }] };
  it("picks the rate valid on the day", () => {
    expect(rateAt(book, "e1", "2025-12-31")).toBe(0);
    expect(rateAt(book, "e1", "2026-06-30")).toBe(700);
    expect(rateAt(book, "e1", "2026-07-01")).toBe(800);
  });
  it("computes employer cost", () => {
    expect(costCents(9 * 60, 750, 1.19)).toBe(8033); // 9 h × €7.50 × 1.19
  });
  it("parses euro amounts", () => {
    expect(parseEurToCents("7,50")).toBe(750);
    expect(parseEurToCents("1 234.5")).toBe(123450);
    expect(parseEurToCents("abc")).toBeNull();
  });
});
