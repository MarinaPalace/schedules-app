import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { jobRoles, locations } from "@/db/schema";
import { canManageDepartment, PEOPLE_ADMINS, type CurrentUser } from "@/lib/session";

export type { LocationLite, RoleLite } from "@/lib/org-types";

/** Roles of departments (active only unless `all`), in their set order. */
export async function loadRoles(departmentIds: string[], all = false) {
  if (!departmentIds.length) return [];
  return db
    .select()
    .from(jobRoles)
    .where(and(inArray(jobRoles.departmentId, departmentIds), all ? undefined : eq(jobRoles.active, true)))
    .orderBy(asc(jobRoles.sort), asc(jobRoles.name));
}

export async function loadLocations(departmentIds: string[], all = false) {
  if (!departmentIds.length) return [];
  return db
    .select()
    .from(locations)
    .where(and(inArray(locations.departmentId, departmentIds), all ? undefined : eq(locations.active, true)))
    .orderBy(asc(locations.sort), asc(locations.code));
}

/** "Main restaurant" by location id (all departments) – for texts that say where a block is. */
export async function placeNames(): Promise<Record<string, string>> {
  const rows = await db.select({ id: locations.id, name: locations.name }).from(locations);
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

/** Admin, owner and GM for every department; a manager for their own departments. */
export async function canSetUpDepartment(user: CurrentUser, departmentId: string) {
  return PEOPLE_ADMINS.includes(user.role) || (await canManageDepartment(user, departmentId));
}
