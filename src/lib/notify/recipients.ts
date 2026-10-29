import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { departmentManagers, employees, user } from "@/db/schema";
import type { Role } from "@/lib/session";

/** Login ids of these employees (those without a login are skipped). */
export async function usersOfEmployees(employeeIds: string[]): Promise<string[]> {
  if (!employeeIds.length) return [];
  const rows = await db
    .select({ id: employees.userId })
    .from(employees)
    .where(and(inArray(employees.id, employeeIds), isNotNull(employees.userId)));
  return rows.map((r) => r.id!);
}

export async function usersWithRoles(roles: Role[]): Promise<string[]> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(user.role, roles), eq(user.active, true)));
  return rows.map((r) => r.id);
}

/** Managers assigned to the department; the GM when nobody is assigned. */
export async function departmentDeciders(departmentId: string): Promise<string[]> {
  const rows = await db
    .select({ id: user.id })
    .from(departmentManagers)
    .innerJoin(user, eq(user.id, departmentManagers.userId))
    .where(and(eq(departmentManagers.departmentId, departmentId), eq(departmentManagers.active, true), eq(user.active, true), eq(user.role, "manager")));
  return rows.length ? rows.map((r) => r.id) : usersWithRoles(["top_manager"]);
}
