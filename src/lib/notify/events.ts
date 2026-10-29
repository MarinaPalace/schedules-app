import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { dateRange, dayLabel } from "@/lib/calendar";
import { viewOfEntry } from "@/lib/cell-view";
import { ABSENCE_CODES, type DayLabels } from "@/lib/codes";
import { key, loadShiftTemplates } from "@/lib/data";
import { describeDay } from "@/lib/describe";
import { formatDate } from "@/lib/dates";
import { formatEur } from "@/lib/money";
import { loadPublishedSchedule } from "@/lib/published";
import { loadSwaps, type SwapRow } from "@/lib/swaps";
import { deliverLater, type NotifyT } from "@/lib/notify/deliver";
import { departmentDeciders, usersOfEmployees, usersWithRoles } from "@/lib/notify/recipients";

// Every function here is fire-and-forget: it runs after the response (see deliverLater).

function labelsFrom(t: NotifyT): DayLabels {
  return {
    dayOff: t("common.dayOff"),
    hourUnit: t("common.hourUnit"),
    minuteUnit: t("common.minuteUnit"),
    absence: Object.fromEntries(ABSENCE_CODES.map((c) => [c, t(`absence.${c}`)])),
  };
}

type Templates = Awaited<ReturnType<typeof loadShiftTemplates>>;
type Entry = SwapRow["moves"][number]["before"];

function plan(e: Entry, templates: Templates, t: NotifyT) {
  if (!e || e.kind === "none") return t("swaps.nothingPlanned");
  const labels = labelsFrom(t);
  const v = viewOfEntry(e, templates, labels);
  return e.kind === "shift" ? `${v.label} ${describeDay(e, labels)}` : describeDay(e, labels);
}

/** "Thu 29.10: Petya Todorova HK … → Day off; Vesela Hristova Day off → HK …" */
function swapLines(s: SwapRow, templates: Templates, t: NotifyT, locale: Locale) {
  return s.dates.flatMap((d) => [
    `${dayLabel(d, locale)}:`,
    ...s.moves.filter((m) => m.date === d).map((m) => `  ${m.employeeId === s.requester.id ? s.requester.name : s.colleague.name}: ${plan(m.before, templates, t)} → ${plan(m.after, templates, t)}`),
  ]);
}

async function swap(id: string) {
  const [[s], templates] = await Promise.all([loadSwaps({ ids: [id] }), loadShiftTemplates()]);
  return s ? { s, templates } : null;
}

export type SwapEvent = "asked" | "toApprove" | "accepted" | "declined" | "cancelled" | "approved" | "rejected";

/** Who hears about each step of a swap. */
export function notifySwap(id: string, event: SwapEvent, by: { userId: string }) {
  let data: Awaited<ReturnType<typeof swap>> = null;
  deliverLater(
    async () => {
      data = await swap(id);
      if (!data) return [];
      const { s } = data;
      const parties = [s.requester.userId, s.colleague.userId].filter((u): u is string => !!u);
      if (event === "asked" || event === "cancelled") return s.colleague.userId ? [s.colleague.userId] : [];
      if (event === "toApprove") return (await departmentDeciders(s.departmentId)).filter((u) => !parties.includes(u));
      if (event === "accepted" || event === "declined") return s.requester.userId ? [s.requester.userId] : [];
      return parties.filter((u) => u !== by.userId);
    },
    (t, r, locale) => {
      if (!data) return null;
      const { s, templates } = data;
      const vars = { requester: s.requester.name, colleague: s.colleague.name, note: s.note ?? "" };
      const lines = [t(`notify.swap.${event}.text`, vars), "", ...swapLines(s, templates, t, locale), ...(s.note ? ["", `“${s.note}”`] : [])];
      if ((event === "approved" || event === "rejected") && s.decisionNote) lines.push("", `${s.decidedBy}: ${s.decisionNote}`);
      return { kind: `swap.${event}`, subject: t(`notify.swap.${event}.subject`, vars), lines, link: event === "toApprove" ? "/swaps" : "/me#swaps" };
    },
  );
}

/** After publishing: each employee whose visible plan changed gets their days for the period. */
export function notifyPublished(employeeIds: string[], from: string, to: string) {
  if (!employeeIds.length) return;
  let schedule: Awaited<ReturnType<typeof loadPublishedSchedule>> = new Map();
  let templates: Templates = [];
  const byUser = new Map<string, string>();
  deliverLater(
    async () => {
      [schedule, templates] = await Promise.all([loadPublishedSchedule(employeeIds, from, to), loadShiftTemplates()]);
      const rows = await Promise.all(employeeIds.map((id) => db.query.employees.findFirst({ where: eq(employees.id, id) })));
      for (const e of rows) if (e?.userId) byUser.set(e.userId, e.id);
      return [...byUser.keys()];
    },
    (t, r, locale) => {
      const empId = byUser.get(r.id);
      if (!empId) return null;
      const days = dateRange(from, to);
      const lines = days.slice(0, 14).map((d) => {
        const e = schedule.get(key(empId, d)) ?? null;
        return `${dayLabel(d, locale)}: ${plan(e, templates, t)}`;
      });
      if (days.length > 14) lines.push("…");
      return {
        kind: "schedule.published",
        subject: t("notify.published.subject", { from: formatDate(from), to: formatDate(to) }),
        lines: [t("notify.published.text"), "", ...lines],
        link: "/me",
      };
    },
  );
}

export function notifyAdvanceRequested(employeeId: string, amountCents: number, byUserId: string) {
  let name = "";
  deliverLater(
    async () => {
      const emp = await db.query.employees.findFirst({ where: eq(employees.id, employeeId) });
      if (!emp) return [];
      name = `${emp.firstName} ${emp.lastName}`;
      const ids = [...(await departmentDeciders(emp.departmentId)), ...(await usersWithRoles(["accountant"]))];
      return ids.filter((u) => u !== emp.userId && u !== byUserId);
    },
    (t) => ({ kind: "advance.requested", subject: t("notify.advance.requested.subject", { name }), lines: [t("notify.advance.requested.text", { name, amount: formatEur(amountCents) })], link: "/advances" }),
  );
}

export function notifyAdvanceOutcome(employeeId: string, amountCents: number, outcome: "approved" | "rejected" | "given", note?: string | null) {
  deliverLater(
    () => usersOfEmployees([employeeId]),
    (t) => ({
      kind: `advance.${outcome}`,
      subject: t(`notify.advance.${outcome}.subject`, { amount: formatEur(amountCents) }),
      lines: [t(`notify.advance.${outcome}.text`, { amount: formatEur(amountCents) }), ...(note ? ["", note] : [])],
      link: "/me",
    }),
  );
}

export function notifyCorrectionRequested(employeeId: string, date: string, byUserId: string) {
  let name = "";
  deliverLater(
    async () => {
      const emp = await db.query.employees.findFirst({ where: eq(employees.id, employeeId) });
      name = emp ? `${emp.firstName} ${emp.lastName}` : "";
      return (await usersWithRoles(["top_manager"])).filter((u) => u !== byUserId);
    },
    (t) => ({ kind: "correction.requested", subject: t("notify.correction.requested.subject", { name }), lines: [t("notify.correction.requested.text", { name, date: formatDate(date) })], link: "/corrections" }),
  );
}

export function notifyCorrectionDecided(requestedBy: string | null, employeeName: string, date: string, decision: "approved" | "rejected") {
  if (!requestedBy) return;
  deliverLater(
    async () => [requestedBy],
    (t) => ({
      kind: `correction.${decision}`,
      subject: t(`notify.correction.${decision}.subject`, { name: employeeName, date: formatDate(date) }),
      lines: [t(`notify.correction.${decision}.text`, { name: employeeName, date: formatDate(date) })],
      link: "/timesheet",
    }),
  );
}
