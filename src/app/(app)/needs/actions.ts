"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { jobRoles, locations, seasons, staffingPlanRows, staffingPlans } from "@/db/schema";
import { withActor, type Tx } from "@/lib/actor";
import { AppError } from "@/lib/app-error";
import { errorMessage } from "@/lib/errors";
import { ALL_DAYS } from "@/lib/needs-rules";
import { canSetUpDepartment } from "@/lib/org";
import { getCurrentUser } from "@/lib/session";

type Result = { error?: string; ok?: string };

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, "hoursFormat");
const scopeSchema = z.object({
  weekdays: z.number().int().min(1).max(ALL_DAYS),
  seasonId: z.uuid().nullable(),
  onDate: z.iso.date().nullable(),
  note: z.string().trim().max(80).nullable().optional(),
});
const rowsSchema = z
  .array(z.object({ from: time, to: time, roleId: z.uuid(), count: z.number().int().min(0).max(99) }))
  .max(200)
  .refine((rows) => rows.every((r) => r.from < r.to), "needsTimeOrder");

async function authorizeLocation(locationId: string) {
  const me = await getCurrentUser();
  if (!me) throw new AppError("notSignedIn");
  const loc = await db.query.locations.findFirst({ where: eq(locations.id, z.uuid().parse(locationId)) });
  if (!loc || !(await canSetUpDepartment(me, loc.departmentId))) throw new AppError("notAllowed");
  return { me, loc };
}

/** One date = that date only (weekdays/season don't apply). */
function normalize(scope: z.infer<typeof scopeSchema>) {
  return scope.onDate ? { weekdays: ALL_DAYS, seasonId: null, onDate: scope.onDate, note: scope.note ?? null } : { ...scope, note: scope.note ?? null };
}

async function insertPlan(tx: Tx, locationId: string, scope: ReturnType<typeof normalize>, rows: z.infer<typeof rowsSchema>, by: string) {
  const [plan] = await tx.insert(staffingPlans).values({ locationId, ...scope, createdBy: by }).returning();
  const kept = rows.filter((r) => r.count > 0);
  if (kept.length) await tx.insert(staffingPlanRows).values(kept.map((r) => ({ planId: plan.id, fromTime: r.from, toTime: r.to, roleId: r.roleId, count: r.count })));
}

async function checkRefs(departmentId: string, scope: ReturnType<typeof normalize>, rows: z.infer<typeof rowsSchema>) {
  const roleIds = [...new Set(rows.map((r) => r.roleId))];
  if (roleIds.length) {
    const ok = await db.select({ id: jobRoles.id, departmentId: jobRoles.departmentId }).from(jobRoles).where(inArray(jobRoles.id, roleIds));
    if (ok.length !== roleIds.length || ok.some((r) => r.departmentId !== departmentId)) throw new AppError("otherDepartment");
  }
  if (scope.seasonId && !(await db.query.seasons.findFirst({ where: eq(seasons.id, scope.seasonId) }))) throw new AppError("invalid");
}

/**
 * Saves the needs of one rule (a new version – history is kept). When the rule's days/season/date
 * were changed, the old rule is removed (saved empty) at the same time.
 */
export async function saveNeeds(input: { locationId: string; scope: unknown; rows: unknown; replaces?: unknown }): Promise<Result> {
  try {
    const { me, loc } = await authorizeLocation(input.locationId);
    const scope = normalize(scopeSchema.parse(input.scope));
    const rows = rowsSchema.parse(input.rows);
    const replaces = input.replaces ? normalize(scopeSchema.parse(input.replaces)) : null;
    await checkRefs(loc.departmentId, scope, rows);
    await withActor(me.id, async (tx) => {
      const same = replaces && replaces.weekdays === scope.weekdays && replaces.seasonId === scope.seasonId && replaces.onDate === scope.onDate;
      if (replaces && !same) await insertPlan(tx, loc.id, replaces, [], me.id);
      await insertPlan(tx, loc.id, scope, rows, me.id);
    });
    revalidatePath("/needs");
    revalidatePath("/schedule");
    revalidatePath("/dashboard");
    return { ok: "saved" };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}

/** Copies one rule (same days/season/date and rows) to other locations of the department. */
export async function copyNeeds(input: { locationId: string; scope: unknown; rows: unknown; to: string[] }): Promise<Result> {
  try {
    const { me, loc } = await authorizeLocation(input.locationId);
    const scope = normalize(scopeSchema.parse(input.scope));
    const rows = rowsSchema.parse(input.rows);
    const targets = z.array(z.uuid()).min(1).max(50).parse(input.to);
    const found = await db.select().from(locations).where(inArray(locations.id, targets));
    if (found.length !== targets.length || found.some((l) => l.departmentId !== loc.departmentId)) throw new AppError("otherDepartment");
    await checkRefs(loc.departmentId, scope, rows);
    await withActor(me.id, async (tx) => {
      for (const l of found) await insertPlan(tx, l.id, scope, rows, me.id);
    });
    revalidatePath("/needs");
    return { ok: "copied" };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}
