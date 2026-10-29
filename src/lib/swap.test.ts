import { describe, expect, it, vi } from "vitest";
import { samePlan, swapDates, swapMoves, swapStatus } from "./swap-state";

vi.mock("server-only", () => ({}));

const M = { kind: "shift", segments: [{ start: "07:00", end: "15:00" }], absenceCode: null, shiftTemplateId: "m" };
const OFF = { kind: "off", segments: [], absenceCode: null, shiftTemplateId: null };

describe("swap status", () => {
  const dates = ["2026-11-05"];
  it("waits for the colleague, then the manager", () => {
    expect(swapStatus([], dates, "2026-11-01")).toBe("waiting_colleague");
    expect(swapStatus(["accepted"], dates, "2026-11-01")).toBe("waiting_manager");
  });
  it("final events win, also after the day has passed", () => {
    expect(swapStatus(["accepted", "approved"], dates, "2026-12-01")).toBe("approved");
    expect(swapStatus(["declined"], dates, "2026-11-01")).toBe("declined");
    expect(swapStatus(["accepted", "rejected"], dates, "2026-11-01")).toBe("rejected");
    expect(swapStatus(["cancelled"], dates, "2026-11-01")).toBe("cancelled");
  });
  it("open requests expire once a day has passed", () => {
    expect(swapStatus(["accepted"], ["2026-11-05", "2026-11-09"], "2026-11-06")).toBe("expired");
    expect(swapStatus([], dates, "2026-11-05")).toBe("waiting_colleague"); // today is still fine
  });
});

describe("swap moves", () => {
  it("one day: both take the other's plan", () => {
    const moves = swapMoves({ requesterId: "a", colleagueId: "b", date1: "2026-11-05", date2: null, snapshot: { "a|2026-11-05": "e1", "b|2026-11-05": null } });
    expect(moves).toEqual([
      { employeeId: "a", date: "2026-11-05", fromEntryId: "e1", toEntryId: null },
      { employeeId: "b", date: "2026-11-05", fromEntryId: null, toEntryId: "e1" },
    ]);
  });
  it("two days: exchanged on each day, dates sorted", () => {
    const r = { requesterId: "a", colleagueId: "b", date1: "2026-11-07", date2: "2026-11-05", snapshot: { "a|2026-11-05": "a5", "b|2026-11-05": "b5", "a|2026-11-07": "a7", "b|2026-11-07": "b7" } };
    expect(swapDates(r)).toEqual(["2026-11-05", "2026-11-07"]);
    expect(swapMoves(r).map((m) => `${m.employeeId}@${m.date.slice(8)}:${m.fromEntryId}->${m.toEntryId}`)).toEqual([
      "a@05:a5->b5",
      "b@05:b5->a5",
      "a@07:a7->b7",
      "b@07:b7->a7",
    ]);
  });
  it("the same date twice counts once", () => {
    expect(swapDates({ date1: "2026-11-05", date2: "2026-11-05" })).toEqual(["2026-11-05"]);
  });
});

describe("same plan", () => {
  it("compares kind, hours, legend and absence", () => {
    expect(samePlan(M, { ...M })).toBe(true);
    expect(samePlan(M, OFF)).toBe(false);
    expect(samePlan(M, { ...M, segments: [{ start: "07:00", end: "16:00" }] })).toBe(false);
    expect(samePlan(null, { ...OFF, kind: "none" })).toBe(true);
    expect(samePlan({ ...OFF, kind: "absence", absenceCode: "О" }, { ...OFF, kind: "absence", absenceCode: "Б" })).toBe(false);
  });
});

describe("schedule PDF", () => {
  it("renders a month with Cyrillic text, many rows and a legend", async () => {
    const { renderSchedulePdf } = await import("./schedule-pdf");
    const days = Array.from({ length: 31 }, (_, i) => ({ top: "пн", bottom: String(i + 1).padStart(2, "0"), weekend: i % 7 > 4, today: i === 3 }));
    const cells = days.map((_, i) => (i % 3 === 0 ? { kind: "off" as const, label: "–", color: null } : { kind: "shift" as const, label: "М", sub: "07–15", color: "#f59e0b" }));
    const pdf = await renderSchedulePdf({
      title: "График · Рецепция",
      subtitle: "Октомври 2026",
      generated: "Отпечатано 29.10.2026",
      days,
      rows: Array.from({ length: 40 }, (_, i) => ({ name: `Иванов Иван ${i}`, position: "Рецепционист", cells, hours: "160", highlight: i === 2 })),
      dayTotals: days.map(() => "40"),
      totalHours: "6400",
      legend: [{ code: "М", color: "#f59e0b", name: "Сутрин", times: "07:00–15:00", hours: "8 ч" }],
      symbols: [{ code: "–", text: "Почивен ден", kind: "off" }],
      labels: { employee: "Служител", hours: "Часове", total: "Общо", legend: "Легенда", page: (n, of) => `Страница ${n} от ${of}` },
    });
    const head = pdf.subarray(0, 5).toString("latin1");
    expect(head).toBe("%PDF-");
    const pages = (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBe(2); // 40 rows don't fit one landscape page; no blank pages from the footer
  });
});
