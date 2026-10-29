import "server-only";
import { and, asc, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { departments, employees, scheduleEntries, swapEvents, swapRequests, user } from "@/db/schema";
import { todayISO } from "@/lib/dates";
import { swapDates, swapMoves, swapStatus, type SwapStatus } from "@/lib/swap-state";

type Entry = typeof scheduleEntries.$inferSelect;
export type SwapRow = Awaited<ReturnType<typeof loadSwaps>>[number];

/**
 * Swap requests with names, events and the before/after of every touched day.
 * Filter by department(s) and/or by an employee taking part (as requester or colleague).
 */
export async function loadSwaps(opts: { ids?: string[]; departmentIds?: string[]; employeeId?: string; limit?: number }) {
  const filters: SQL[] = [];
  if (opts.ids) {
    if (!opts.ids.length) return [];
    filters.push(inArray(swapRequests.id, opts.ids));
  }
  if (opts.departmentIds) {
    if (!opts.departmentIds.length) return [];
    filters.push(inArray(swapRequests.departmentId, opts.departmentIds));
  }
  if (opts.employeeId) filters.push(or(eq(swapRequests.requesterId, opts.employeeId), eq(swapRequests.colleagueId, opts.employeeId))!);

  const requester = alias(employees, "requester");
  const colleague = alias(employees, "colleague");
  const rows = await db
    .select({ r: swapRequests, requester, colleague, dept: departments.name })
    .from(swapRequests)
    .innerJoin(requester, eq(requester.id, swapRequests.requesterId))
    .innerJoin(colleague, eq(colleague.id, swapRequests.colleagueId))
    .innerJoin(departments, eq(departments.id, swapRequests.departmentId))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(swapRequests.createdAt))
    .limit(opts.limit ?? 100);
  if (!rows.length) return [];

  const ids = rows.map((x) => x.r.id);
  const entryIds = [...new Set(rows.flatMap((x) => Object.values(x.r.snapshot).filter((v): v is string => !!v)))];
  const [events, entries] = await Promise.all([
    db
      .select({ e: swapEvents, by: user.name })
      .from(swapEvents)
      .leftJoin(user, eq(user.id, swapEvents.createdBy))
      .where(inArray(swapEvents.requestId, ids))
      .orderBy(asc(swapEvents.createdAt)),
    entryIds.length ? db.select().from(scheduleEntries).where(inArray(scheduleEntries.id, entryIds)) : Promise.resolve([] as Entry[]),
  ]);
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const today = todayISO();

  return rows.map(({ r, requester, colleague, dept }) => {
    const ev = events.filter((x) => x.e.requestId === r.id).map((x) => ({ ...x.e, by: x.by }));
    const dates = swapDates(r);
    const status: SwapStatus = swapStatus(
      ev.map((e) => e.action),
      dates,
      today,
    );
    const moves = swapMoves(r).map((m) => ({
      ...m,
      before: m.fromEntryId ? (entryById.get(m.fromEntryId) ?? null) : null,
      after: m.toEntryId ? (entryById.get(m.toEntryId) ?? null) : null,
    }));
    const last = ev.at(-1);
    return {
      id: r.id,
      departmentId: r.departmentId,
      department: dept,
      dates,
      note: r.note,
      createdAt: r.createdAt,
      requester: { id: requester.id, userId: requester.userId, name: `${requester.firstName} ${requester.lastName}` },
      colleague: { id: colleague.id, userId: colleague.userId, name: `${colleague.firstName} ${colleague.lastName}` },
      status,
      events: ev,
      decidedBy: last && last.action !== "accepted" ? last.by : null,
      decisionNote: last && last.action !== "accepted" ? last.note : null,
      moves,
    };
  });
}

/** How many swaps wait for this employee's answer. */
export async function countSwapsWaitingFor(employeeId: string) {
  const rows = await loadSwaps({ employeeId, limit: 50 });
  return rows.filter((s) => s.status === "waiting_colleague" && s.colleague.id === employeeId).length;
}
