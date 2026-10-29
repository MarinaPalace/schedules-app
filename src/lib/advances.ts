import "server-only";
import { and, desc, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { advanceDecisions, advancePayments, advanceRequests, employees, user } from "@/db/schema";

export type AdvanceRow = Awaited<ReturnType<typeof loadAdvances>>[number];

/** Advance requests with their decision (if any). `month` filters by request date. */
export async function loadAdvances(opts: { employeeIds?: string[]; departmentIds?: string[]; month?: string }) {
  const filters: SQL[] = [];
  if (opts.employeeIds) {
    if (!opts.employeeIds.length) return [];
    filters.push(inArray(advanceRequests.employeeId, opts.employeeIds));
  }
  if (opts.departmentIds) {
    if (!opts.departmentIds.length) return [];
    filters.push(inArray(employees.departmentId, opts.departmentIds));
  }
  if (opts.month) {
    const [y, m] = opts.month.split("-").map(Number);
    filters.push(gte(advanceRequests.createdAt, new Date(Date.UTC(y, m - 1, 1))), lt(advanceRequests.createdAt, new Date(Date.UTC(y, m, 1))));
  }
  const decider = alias(user, "decider");
  const payer = alias(user, "payer");
  return db
    .select({
      id: advanceRequests.id,
      employeeId: advanceRequests.employeeId,
      employeeName: employees.firstName,
      employeeLast: employees.lastName,
      employeeUserId: employees.userId,
      amountCents: advanceRequests.amountCents,
      note: advanceRequests.note,
      createdAt: advanceRequests.createdAt,
      requestedBy: user.name,
      decision: advanceDecisions.decision,
      decisionNote: advanceDecisions.note,
      decidedAt: advanceDecisions.createdAt,
      decidedBy: decider.name,
      givenAt: advancePayments.createdAt,
      givenBy: payer.name,
    })
    .from(advanceRequests)
    .innerJoin(employees, eq(employees.id, advanceRequests.employeeId))
    .leftJoin(advanceDecisions, eq(advanceDecisions.requestId, advanceRequests.id))
    .leftJoin(user, eq(user.id, advanceRequests.createdBy))
    .leftJoin(decider, eq(decider.id, advanceDecisions.createdBy))
    .leftJoin(advancePayments, eq(advancePayments.requestId, advanceRequests.id))
    .leftJoin(payer, eq(payer.id, advancePayments.createdBy))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(advanceRequests.createdAt));
}
