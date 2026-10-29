import { describe, expect, it } from "vitest";
import { countBySlot, dayBlocks, dayIntervals, minStaff, pick, presenceBetween } from "./coverage";
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

describe("staff per role and place", () => {
  const people = [
    // Waiter: morning at R1, evening at B1 (split shift at two places)
    dayBlocks({ segments: [{ start: "09:00", end: "13:00", locationId: "R1" }, { start: "17:00", end: "21:00", locationId: "B1" }], roleId: "waiter" }),
    // Assistant manager at R1 all day
    dayBlocks({ segments: [{ start: "08:00", end: "16:00", locationId: "R1" }], roleId: "am" }),
    // Waiter without a place yet
    dayBlocks({ segments: [{ start: "10:00", end: "14:00" }], roleId: "waiter" }),
  ];
  it("counts by role at one place", () => {
    const waitersAtR1 = countBySlot(people.map((b) => pick(b, { locationId: "R1", roleId: "waiter" })), 60);
    expect(waitersAtR1[10]).toBe(1);
    expect(waitersAtR1[18]).toBe(0); // the evening block is at the bar
    const waitersAnywhere = countBySlot(people.map((b) => pick(b, { roleId: "waiter" })), 60);
    expect(waitersAnywhere[10]).toBe(2);
    expect(waitersAnywhere[18]).toBe(1);
    expect(minStaff(people.map((b) => pick(b, { locationId: "R1" })), H(9), H(12))).toBe(2);
  });
  it("a person at two places counts at only one at a time", () => {
    const atR1 = countBySlot(people.map((b) => pick(b, { locationId: "R1" })), 60);
    const atB1 = countBySlot(people.map((b) => pick(b, { locationId: "B1" })), 60);
    expect(atR1[18] + atB1[18]).toBe(1);
    expect(atR1[10] + atB1[10]).toBe(2);
  });
  it("hours at a place share the break by time", async () => {
    const { paidAt } = await import("./cell-view");
    const c = { kind: "shift" as const, label: "S", color: null, title: "", tool: { type: "none" as const }, paidMinutes: 450, segments: [{ start: "09:00", end: "13:00", locationId: "R1" }, { start: "17:00", end: "21:00", locationId: "B1" }] };
    expect(paidAt(c, "R1")).toBe(225);
    expect(paidAt(c, "B1")).toBe(225);
    expect(paidAt(c, null)).toBe(450);
  });
});
