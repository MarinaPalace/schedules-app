import "server-only";
import { and, asc, desc, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { scheduleEntries, schedulePublications } from "@/db/schema";
import type { Tx } from "@/lib/actor";
import { key } from "@/lib/data";

export type Cutoff = (departmentId: string, date: string) => Date | null;
type Query = typeof db | Tx;

/** For each department and day: the time of the latest publication covering that day. */
export async function loadCutoffs(departmentIds: string[], from: string, to: string, q: Query = db): Promise<Cutoff> {
  const pubs = departmentIds.length
    ? await q
        .select()
        .from(schedulePublications)
        .where(
          and(
            inArray(schedulePublications.departmentId, departmentIds),
            lte(schedulePublications.fromDate, to),
            gte(schedulePublications.toDate, from),
          ),
        )
    : [];
  return (departmentId, date) => {
    let latest: Date | null = null;
    for (const p of pubs) {
      if (p.departmentId === departmentId && p.fromDate <= date && p.toDate >= date && (!latest || p.createdAt > latest)) latest = p.createdAt;
    }
    return latest;
  };
}

/** An entry employees can see: made before the last publication of its day, or written by an approved swap. */
export function isPublished(e: { departmentId: string; workDate: string; createdAt: Date; swapRequestId: string | null }, cutoff: Cutoff): boolean {
  if (e.swapRequestId) return true;
  const c = cutoff(e.departmentId, e.workDate);
  return !!c && e.createdAt <= c;
}

/**
 * The schedule as employees see it: per day, the latest visible entry.
 * With `latest`, also returns the newest entry per day (published or not), to detect pending edits.
 */
export async function loadPublishedSchedule(employeeIds: string[], from: string, to: string, q: Query = db) {
  const result = new Map<string, typeof scheduleEntries.$inferSelect>();
  if (!employeeIds.length) return result;
  const entries = await loadEntries(employeeIds, from, to, q);
  const cutoff = await loadCutoffs([...new Set(entries.map((e) => e.departmentId))], from, to, q);
  for (const e of entries) if (isPublished(e, cutoff)) result.set(key(e.employeeId, e.workDate), e);
  return result;
}

/** Published and newest entry per day, for checking that nothing changed since a snapshot. */
export async function loadPublishedAndLatest(employeeIds: string[], from: string, to: string, q: Query = db) {
  const published = new Map<string, typeof scheduleEntries.$inferSelect>();
  const latest = new Map<string, typeof scheduleEntries.$inferSelect>();
  if (!employeeIds.length) return { published, latest };
  const entries = await loadEntries(employeeIds, from, to, q);
  const cutoff = await loadCutoffs([...new Set(entries.map((e) => e.departmentId))], from, to, q);
  for (const e of entries) {
    const k = key(e.employeeId, e.workDate);
    latest.set(k, e);
    if (isPublished(e, cutoff)) published.set(k, e);
  }
  return { published, latest };
}

function loadEntries(employeeIds: string[], from: string, to: string, q: Query) {
  return q
    .select()
    .from(scheduleEntries)
    .where(and(inArray(scheduleEntries.employeeId, employeeIds), gte(scheduleEntries.workDate, from), lte(scheduleEntries.workDate, to)))
    .orderBy(asc(scheduleEntries.createdAt), asc(scheduleEntries.id));
}

/** Newest plan rows from `from` to `to` that employees can't see yet (same rule as the amber dots on the schedule). */
async function unpublishedEntries(departmentIds: string[], from: string, to: string) {
  if (!departmentIds.length || from > to) return [];
  const latest = await db
    .selectDistinctOn([scheduleEntries.employeeId, scheduleEntries.workDate])
    .from(scheduleEntries)
    .where(and(inArray(scheduleEntries.departmentId, departmentIds), gte(scheduleEntries.workDate, from), lte(scheduleEntries.workDate, to)))
    .orderBy(scheduleEntries.employeeId, scheduleEntries.workDate, desc(scheduleEntries.createdAt));
  const cutoff = await loadCutoffs(departmentIds, from, to);
  return latest.filter((e) => !isPublished(e, cutoff) && !(e.kind === "none" && !cutoff(e.departmentId, e.workDate)));
}

/** Per department: how many unpublished changes, and the first such day. */
export async function loadUnpublished(departmentIds: string[], from: string, to: string) {
  const result = new Map<string, { count: number; firstDate: string }>();
  for (const e of await unpublishedEntries(departmentIds, from, to)) {
    const r = result.get(e.departmentId) ?? { count: 0, firstDate: e.workDate };
    r.count++;
    if (e.workDate < r.firstDate) r.firstDate = e.workDate;
    result.set(e.departmentId, r);
  }
  return result;
}

/** Employees whose visible plan will change when the period is published. */
export async function loadUnpublishedEmployees(departmentId: string, from: string, to: string): Promise<string[]> {
  return [...new Set((await unpublishedEntries([departmentId], from, to)).map((e) => e.employeeId))];
}
