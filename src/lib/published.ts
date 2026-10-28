import "server-only";
import { and, asc, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { scheduleEntries, schedulePublications } from "@/db/schema";
import { key } from "@/lib/data";

export type Cutoff = (departmentId: string, date: string) => Date | null;

/** For each department and day: the time of the latest publication covering that day. */
export async function loadCutoffs(departmentIds: string[], from: string, to: string): Promise<Cutoff> {
  const pubs = departmentIds.length
    ? await db
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

/** The schedule as employees see it: per day, the latest entry made before the last publication. */
export async function loadPublishedSchedule(employeeIds: string[], from: string, to: string) {
  const result = new Map<string, typeof scheduleEntries.$inferSelect>();
  if (!employeeIds.length) return result;
  const entries = await db
    .select()
    .from(scheduleEntries)
    .where(and(inArray(scheduleEntries.employeeId, employeeIds), gte(scheduleEntries.workDate, from), lte(scheduleEntries.workDate, to)))
    .orderBy(asc(scheduleEntries.createdAt));
  const cutoff = await loadCutoffs([...new Set(entries.map((e) => e.departmentId))], from, to);
  for (const e of entries) {
    const c = cutoff(e.departmentId, e.workDate);
    if (c && e.createdAt <= c) result.set(key(e.employeeId, e.workDate), e);
  }
  return result;
}
