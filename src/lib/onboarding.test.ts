import { describe, expect, it } from "vitest";
import { parseRows } from "./import-rows";
import { parsePayPerHour } from "./money";
import { ALL_DAYS, currentPlans, dayGaps, needSlots, neededMinutes, planFor, WEEKEND, type NeedPlan } from "./needs-rules";
import { suggestUsername, uniqueUsername } from "./translit";

const plan = (p: Partial<NeedPlan>): NeedPlan => ({ id: "p", locationId: "L", weekdays: ALL_DAYS, seasonId: null, onDate: null, note: null, createdAt: "2026-01-01T00:00:00Z", rows: [{ from: "08:00", to: "10:00", roleId: "w", count: 1 }], ...p });
const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const seg = (start: string, end: string, roleId = "w") => [{ start: m(start), end: m(end), locationId: "L", roleId }];

describe("usernames", () => {
  it("transliterates Cyrillic names", () => {
    expect(suggestUsername("Иван", "Петров")).toBe("ivan.petrov");
    expect(suggestUsername(" Щерю ", "Жеков-Йорданов")).toBe("shteryu.zhekov-yordanov");
    expect(suggestUsername("Анна", "")).toBe("anna");
  });
  it("finds a free username", () => {
    expect(uniqueUsername("ivan.petrov", new Set())).toBe("ivan.petrov");
    expect(uniqueUsername("ivan.petrov", new Set(["ivan.petrov", "ivan.petrov2"]))).toBe("ivan.petrov3");
  });
});

describe("pay per hour", () => {
  it("reads an hourly amount or monthly pay / hours", () => {
    expect(parsePayPerHour("6.25")).toBe(625);
    expect(parsePayPerHour("6,50 €")).toBe(650);
    expect(parsePayPerHour("1000/160")).toBe(625);
    expect(parsePayPerHour("1 200 / 168")).toBe(714);
  });
  it("rejects nonsense", () => {
    expect(parsePayPerHour("")).toBeNull();
    expect(parsePayPerHour("abc")).toBeNull();
    expect(parsePayPerHour("0")).toBeNull();
    expect(parsePayPerHour("1000/0")).toBeNull();
  });
});

describe("staff import rows", () => {
  it("reads Excel paste and skips the header", () => {
    const rows = parseRows("Име\tФамилия\tТелефон\r\nИван\tПетров\t0888\t\tСервитьор\tR1\t6,50\n\nМария\tИванова");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ firstName: "Иван", lastName: "Петров", phone: "0888", email: "", position: "Сервитьор", place: "R1", pay: "6,50" });
    expect(rows[1].lastName).toBe("Иванова");
    expect(rows[1].pay).toBe("");
  });
  it("accepts semicolons", () => {
    expect(parseRows("Ivan;Petrov;;;Waiter;;1000/160")[0]).toMatchObject({ position: "Waiter", pay: "1000/160" });
  });
});

describe("staffing needs", () => {
  const seasons = [{ id: "high", name: "High", fromDate: "2026-06-01", toDate: "2026-09-30", active: true }];
  const all = plan({ id: "all" });
  const weekend = plan({ id: "weekend", weekdays: WEEKEND });
  const summer = plan({ id: "summer", seasonId: "high" });
  const wedding = plan({ id: "wedding", onDate: "2026-07-04" });
  const plans = [all, weekend, summer, wedding];

  it("picks date › season › all year, narrowest weekdays first", () => {
    expect(planFor(plans, "2026-03-04", seasons)?.plan.id).toBe("all"); // Wednesday
    expect(planFor(plans, "2026-03-07", seasons)?.plan.id).toBe("weekend"); // Saturday
    expect(planFor(plans, "2026-07-01", seasons)).toMatchObject({ kind: "season", seasonName: "High" });
    expect(planFor(plans, "2026-07-04", seasons)?.kind).toBe("date");
    expect(planFor([weekend], "2026-03-04", seasons)).toBeNull();
    expect(planFor(plans, "2026-07-01", [{ ...seasons[0], active: false }])?.plan.id).toBe("all");
  });

  it("keeps the latest version and drops rules saved empty", () => {
    const v2 = plan({ id: "v2", createdAt: "2026-02-01T00:00:00Z", rows: [{ from: "06:30", to: "08:30", roleId: "w", count: 2 }] });
    expect(currentPlans([all, v2]).map((p) => p.id)).toEqual(["v2"]);
    expect(currentPlans([all, plan({ id: "gone", createdAt: "2026-03-01T00:00:00Z", rows: [] })])).toEqual([]);
  });

  it("counts needs per half hour and finds gaps", () => {
    const rows = [
      { from: "06:30", to: "08:30", roleId: "w", count: 2 },
      { from: "08:30", to: "14:30", roleId: "w", count: 5 },
      { from: "06:30", to: "14:30", roleId: "am", count: 1 },
    ];
    const slots = needSlots(rows).get("w")!;
    expect(slots[13]).toBe(2); // 06:30
    expect(slots[17]).toBe(5); // 08:30
    expect(slots[29]).toBe(0); // 14:30
    expect(neededMinutes(rows).get("w")).toBe(2 * 120 + 5 * 360);

    const people = [seg("06:00", "15:00"), seg("06:30", "14:30"), seg("08:30", "14:30"), seg("06:30", "14:30", "am")];
    const { missing, extra } = dayGaps(people, { L: rows });
    expect(missing).toEqual([{ locationId: "L", roleId: "w", from: "08:30", to: "14:30", missing: 2 }]);
    expect(extra).toEqual([]);
    const over = dayGaps([seg("06:30", "08:30"), seg("06:30", "08:30"), seg("06:30", "08:30")], { L: [rows[0]] });
    expect(over.missing).toEqual([]);
    expect(over.extra).toEqual([{ locationId: "L", roleId: "w", from: "06:30", to: "08:30", missing: 1 }]);
  });
});
