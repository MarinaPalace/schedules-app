import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import { dateRange, monthBounds } from "@/lib/calendar";
import { getCostFactor, loadBudgets, loadRates, loadSchedule, loadTimesheet } from "@/lib/data";
import { costCents, rateAt } from "@/lib/rates";
import { todayISO } from "@/lib/dates";

export type EmployeeMonth = {
  employeeId: string;
  name: string;
  approvedMinutes: number;
  plannedMinutes: number; // scheduled on days not yet approved
  actualCents: number;
  projectedCents: number;
};

export type DepartmentMonth = {
  departmentId: string;
  budgetCents: number | null;
  budgetHours: number | null;
  actualCents: number;
  projectedCents: number;
  actualMinutes: number;
  projectedMinutes: number;
  /** Past days with scheduled work but no approved Forma 76. */
  unapprovedDays: number;
  /** Per day: cost from approved hours and cost from schedule (for not yet approved days). */
  days: { date: string; actualCents: number; plannedCents: number }[];
  employees: EmployeeMonth[];
};

/**
 * Labour cost per department for a month.
 * Actual = approved Forma 76 hours. Projected = actual + scheduled hours on days not yet approved.
 * Each day is attributed to the department stored on its row.
 */
export async function computeMonth(departmentIds: string[], month: string): Promise<Map<string, DepartmentMonth>> {
  const { from, to } = monthBounds(month);
  const today = todayISO();
  const [schedule, timesheet, rates, factor, budgetRows] = await Promise.all([
    loadSchedule("all", from, to),
    loadTimesheet("all", from, to),
    loadRates("all"),
    getCostFactor(),
    loadBudgets(departmentIds, month),
  ]);

  const dates = dateRange(from, to);
  const result = new Map<string, DepartmentMonth>();
  for (const id of departmentIds) {
    const b = budgetRows.get(id);
    result.set(id, {
      departmentId: id,
      budgetCents: b?.amountCents ?? null,
      budgetHours: b?.hours ?? null,
      actualCents: 0,
      projectedCents: 0,
      actualMinutes: 0,
      projectedMinutes: 0,
      unapprovedDays: 0,
      days: dates.map((date) => ({ date, actualCents: 0, plannedCents: 0 })),
      employees: [],
    });
  }

  const perEmployee = new Map<string, EmployeeMonth & { departmentId: string }>();
  const touch = (departmentId: string, employeeId: string) => {
    const k = `${departmentId}|${employeeId}`;
    let e = perEmployee.get(k);
    if (!e) {
      e = { departmentId, employeeId, name: "", approvedMinutes: 0, plannedMinutes: 0, actualCents: 0, projectedCents: 0 };
      perEmployee.set(k, e);
    }
    return e;
  };

  const keys = new Set([...schedule.keys(), ...timesheet.keys()]);
  for (const k of keys) {
    const [employeeId, date] = k.split("|");
    const dayIndex = dates.indexOf(date);
    const ts = timesheet.get(k);
    const sc = schedule.get(k);
    const rate = rateAt(rates, employeeId, date);

    if (ts) {
      const dept = result.get(ts.departmentId);
      if (!dept) continue;
      const cents = costCents(ts.paidMinutes, rate, factor);
      dept.actualCents += cents;
      dept.projectedCents += cents;
      dept.actualMinutes += ts.paidMinutes;
      dept.projectedMinutes += ts.paidMinutes;
      dept.days[dayIndex].actualCents += cents;
      const e = touch(ts.departmentId, employeeId);
      e.approvedMinutes += ts.paidMinutes;
      e.actualCents += cents;
      e.projectedCents += cents;
    } else if (sc) {
      const dept = result.get(sc.departmentId);
      if (!dept) continue;
      const cents = costCents(sc.paidMinutes, rate, factor);
      dept.projectedCents += cents;
      dept.projectedMinutes += sc.paidMinutes;
      dept.days[dayIndex].plannedCents += cents;
      if (date < today && sc.kind === "shift") dept.unapprovedDays++;
      const e = touch(sc.departmentId, employeeId);
      e.plannedMinutes += sc.paidMinutes;
      e.projectedCents += cents;
    }
  }

  const empIds = [...new Set([...perEmployee.values()].map((e) => e.employeeId))];
  const names = empIds.length
    ? new Map(
        (
          await db
            .select({ id: employees.id, first: employees.firstName, last: employees.lastName })
            .from(employees)
            .where(inArray(employees.id, empIds))
        ).map((e) => [e.id, `${e.last} ${e.first}`]),
      )
    : new Map<string, string>();

  for (const e of perEmployee.values()) {
    const { departmentId, ...rest } = e;
    result.get(departmentId)?.employees.push({ ...rest, name: names.get(e.employeeId) ?? "?" });
  }
  for (const d of result.values()) d.employees.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

export type BudgetStatus = "none" | "under" | "on_track" | "over";

/** Over = projected above budget; on track = within 3% below budget. */
export function budgetStatus(d: Pick<DepartmentMonth, "budgetCents" | "projectedCents">): BudgetStatus {
  if (!d.budgetCents) return "none";
  const ratio = d.projectedCents / d.budgetCents;
  if (ratio > 1) return "over";
  if (ratio >= 0.97) return "on_track";
  return "under";
}
