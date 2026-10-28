import "server-only";
import { type RateBook } from "@/lib/rates";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  budgets,
  correctionDecisions,
  correctionRequests,
  employeeRates,
  employees,
  scheduleEntries,
  settings,
  shiftTemplates,
  timesheetEntries,
} from "@/db/schema";

export const key = (employeeId: string, date: string) => `${employeeId}|${date}`;

/** Latest schedule row per (employee, day). */
export async function loadSchedule(employeeIds: string[] | "all", from: string, to: string) {
  if (!employeeIds.length) return new Map<string, typeof scheduleEntries.$inferSelect>();
  const rows = await db
    .selectDistinctOn([scheduleEntries.employeeId, scheduleEntries.workDate])
    .from(scheduleEntries)
    .where(and(employeeIds === "all" ? undefined : inArray(scheduleEntries.employeeId, employeeIds), gte(scheduleEntries.workDate, from), lte(scheduleEntries.workDate, to)))
    .orderBy(scheduleEntries.employeeId, scheduleEntries.workDate, desc(scheduleEntries.createdAt));
  return new Map(rows.map((r) => [key(r.employeeId, r.workDate), r]));
}

/** Highest approved Forma 76 version per (employee, day). */
export async function loadTimesheet(employeeIds: string[] | "all", from: string, to: string) {
  if (!employeeIds.length) return new Map<string, typeof timesheetEntries.$inferSelect>();
  const rows = await db
    .selectDistinctOn([timesheetEntries.employeeId, timesheetEntries.workDate])
    .from(timesheetEntries)
    .where(and(employeeIds === "all" ? undefined : inArray(timesheetEntries.employeeId, employeeIds), gte(timesheetEntries.workDate, from), lte(timesheetEntries.workDate, to)))
    .orderBy(timesheetEntries.employeeId, timesheetEntries.workDate, desc(timesheetEntries.version));
  return new Map(rows.map((r) => [key(r.employeeId, r.workDate), r]));
}

/** Correction requests without a decision yet. */
export async function loadPendingCorrections(employeeIds: string[], from: string, to: string) {
  if (!employeeIds.length) return new Map<string, typeof correctionRequests.$inferSelect>();
  const rows = await db
    .select({ r: correctionRequests })
    .from(correctionRequests)
    .leftJoin(correctionDecisions, eq(correctionDecisions.requestId, correctionRequests.id))
    .where(
      and(
        isNull(correctionDecisions.id),
        inArray(correctionRequests.employeeId, employeeIds),
        gte(correctionRequests.workDate, from),
        lte(correctionRequests.workDate, to),
      ),
    );
  return new Map(rows.map(({ r }) => [key(r.employeeId, r.workDate), r]));
}

export async function loadRates(employeeIds: string[] | "all"): Promise<RateBook> {
  const book: RateBook = new Map();
  if (!employeeIds.length) return book;
  const rows = await db
    .select()
    .from(employeeRates)
    .where(employeeIds === "all" ? undefined : inArray(employeeRates.employeeId, employeeIds))
    .orderBy(asc(employeeRates.effectiveFrom), asc(employeeRates.createdAt));
  for (const r of rows) {
    const list = book.get(r.employeeId) ?? [];
    // Same start date entered twice: the later entry wins.
    if (list.at(-1)?.from === r.effectiveFrom) list.pop();
    list.push({ from: r.effectiveFrom, cents: r.hourlyRateCents });
    book.set(r.employeeId, list);
  }
  return book;
}

export async function getCostFactor(): Promise<number> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "employer_cost_factor") });
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Latest budget per department for a month ("YYYY-MM"). */
export async function loadBudgets(departmentIds: string[], month: string) {
  if (!departmentIds.length) return new Map<string, typeof budgets.$inferSelect>();
  const rows = await db
    .selectDistinctOn([budgets.departmentId])
    .from(budgets)
    .where(and(inArray(budgets.departmentId, departmentIds), eq(budgets.month, `${month}-01`)))
    .orderBy(budgets.departmentId, desc(budgets.createdAt));
  return new Map(rows.map((r) => [r.departmentId, r]));
}

/**
 * Employees to show for a department in a period: active members plus anyone
 * who has schedule/timesheet rows for this department in the period.
 */
export async function loadDepartmentEmployees(departmentId: string, from: string, to: string) {
  const touched = db
    .selectDistinct({ id: scheduleEntries.employeeId })
    .from(scheduleEntries)
    .where(and(eq(scheduleEntries.departmentId, departmentId), gte(scheduleEntries.workDate, from), lte(scheduleEntries.workDate, to)));
  const touchedTs = db
    .selectDistinct({ id: timesheetEntries.employeeId })
    .from(timesheetEntries)
    .where(and(eq(timesheetEntries.departmentId, departmentId), gte(timesheetEntries.workDate, from), lte(timesheetEntries.workDate, to)));
  return db
    .select()
    .from(employees)
    .where(
      or(
        and(eq(employees.departmentId, departmentId), eq(employees.active, true)),
        inArray(employees.id, touched),
        inArray(employees.id, touchedTs),
      ),
    )
    .orderBy(asc(employees.lastName), asc(employees.firstName));
}

export async function loadShiftTemplates(departmentId?: string) {
  return db
    .select()
    .from(shiftTemplates)
    .where(
      and(
        eq(shiftTemplates.active, true),
        departmentId ? or(isNull(shiftTemplates.departmentId), eq(shiftTemplates.departmentId, departmentId)) : undefined,
      ),
    )
    .orderBy(asc(shiftTemplates.code));
}
