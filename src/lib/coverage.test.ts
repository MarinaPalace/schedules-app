import { describe, expect, it } from "vitest";
import { countBySlot, dayIntervals, minStaff, presenceBetween } from "./coverage";
import { cellLabel, customCodes, viewOfEntry, viewOfTool } from "./cell-view";

const seg = (start: string, end: string) => ({ start, end });
const H = (h: number) => h * 60;

describe("staff over the day", () => {
  it("cuts overnight shifts at midnight and carries the rest into the next day", () => {
    expect(dayIntervals([seg("23:00", "07:00")])).toEqual([[H(23), H(24)]]);
    expect(dayIntervals([seg("07:00", "15:00")], [seg("23:00", "07:00")])).toEqual([
      [0, H(7)],
      [H(7), H(15)],
    ]);
  });

  it("counts people per slot, split shifts included", () => {
    const people = [dayIntervals([seg("07:00", "15:00")]), dayIntervals([seg("09:00", "11:00"), seg("15:00", "20:00")]), dayIntervals([])];
    const perHour = countBySlot(people, 60);
    expect(perHour[6]).toBe(0);
    expect(perHour[7]).toBe(1);
    expect(perHour[10]).toBe(2);
    expect(perHour[12]).toBe(1);
    expect(perHour[16]).toBe(1);
  });

  it("tells who is there the whole time, part of it, or not at all", () => {
    const a = dayIntervals([seg("07:00", "15:00")]);
    const b = dayIntervals([seg("09:00", "11:00"), seg("15:00", "20:00")]);
    const c = dayIntervals([seg("07:00", "10:00"), seg("10:00", "12:00")]); // back-to-back blocks = whole time
    expect(presenceBetween(a, H(7), H(12))).toBe("full");
    expect(presenceBetween(b, H(7), H(12))).toBe("part");
    expect(presenceBetween(c, H(7), H(12))).toBe("full");
    expect(presenceBetween([], H(7), H(12))).toBe("none");
    expect(minStaff([a, b, c], H(7), H(12))).toBe(2);
    expect(minStaff([a, b, c], H(9), H(11))).toBe(3);
  });
});

describe("custom hours in the legend", () => {
  const labels = { dayOff: "Off", hourUnit: "h", minuteUnit: "min", absence: {} };
  it("gives the same hours the same automatic code, numbered by start time", () => {
    const late = viewOfTool({ type: "custom", text: "14:00-22:00", breakMinutes: 30 }, [], labels)!;
    const early = viewOfTool({ type: "custom", text: "06:00-10:00" }, [], labels)!;
    const codes = customCodes([late, early, late], "P");
    expect(cellLabel(early, codes)).toBe("P1");
    expect(cellLabel(late, codes)).toBe("P2");
    expect(codes.get(late.custom!)).toMatchObject({ breakMinutes: 30, paidMinutes: 450, times: "14:00–22:00" });
  });
  it("a break longer than the shift is refused", () => {
    expect(viewOfTool({ type: "custom", text: "08:00-09:00", breakMinutes: 60 }, [], labels)).toBeNull();
  });
  it("legend shifts keep their own code", () => {
    const tpl = { id: "t", code: "M", name: "Morning", color: "#f00", segments: [seg("07:00", "15:00")], paidMinutes: 480, breakMinutes: 0 };
    const v = viewOfEntry({ kind: "shift", segments: tpl.segments, paidMinutes: 480, breakMinutes: 0, shiftTemplateId: "t", absenceCode: null }, [tpl], labels);
    expect(cellLabel(v, customCodes([v], "P"))).toBe("M");
  });
});
