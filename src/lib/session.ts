import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { departmentManagers, departments, employees } from "@/db/schema";
import { AppError } from "@/lib/app-error";

export const ROLES = ["employee", "manager", "top_manager", "owner", "accountant", "admin"] as const;
export type Role = (typeof ROLES)[number];

export type CurrentUser = {
  id: string;
  name: string;
  username: string | null;
  role: Role;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const u = s.user as typeof s.user & { role?: string; active?: boolean; username?: string | null };
  if (u.active === false) return null;
  return { id: u.id, name: u.name, username: u.username ?? null, role: (u.role ?? "employee") as Role };
});

/** Redirects to /login when signed out, and home when the role is not allowed. */
export async function requireUser(roles?: readonly Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect("/");
  return user;
}

/** For server actions: throws instead of redirecting. */
export async function assertRole(roles: readonly Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || !roles.includes(user.role)) throw new AppError("notAllowed");
  return user;
}

export const SEES_ALL_DEPARTMENTS: readonly Role[] = ["top_manager", "owner", "accountant", "admin"];
/** May create departments and employees and assign department managers. */
export const PEOPLE_ADMINS: readonly Role[] = ["admin", "owner", "top_manager"];

/** Roles a user may give to others (nobody can hand out more power than they have). */
export function assignableRoles(me: CurrentUser): Role[] {
  if (me.role === "admin") return [...ROLES];
  if (me.role === "owner") return ROLES.filter((r) => r !== "admin");
  if (me.role === "top_manager") return ["employee", "manager"];
  return [];
}
export const MANAGES: readonly Role[] = ["manager", "top_manager", "admin"];

/** Departments whose data this user may see as a manager-level user. */
export const getVisibleDepartments = cache(async (user: CurrentUser) => {
  if (SEES_ALL_DEPARTMENTS.includes(user.role)) {
    return db.select().from(departments).where(eq(departments.active, true)).orderBy(departments.name);
  }
  if (user.role === "manager") {
    return db
      .select({ id: departments.id, name: departments.name, active: departments.active, createdAt: departments.createdAt })
      .from(departmentManagers)
      .innerJoin(departments, eq(departments.id, departmentManagers.departmentId))
      .where(and(eq(departmentManagers.userId, user.id), eq(departmentManagers.active, true), eq(departments.active, true)))
      .orderBy(departments.name);
  }
  return [];
});

export async function canManageDepartment(user: CurrentUser, departmentId: string): Promise<boolean> {
  if (user.role === "top_manager" || user.role === "admin") return true;
  if (user.role !== "manager") return false;
  const visible = await getVisibleDepartments(user);
  return visible.some((d) => d.id === departmentId);
}

export const getEmployeeForUser = cache(async (userId: string) => {
  return db.query.employees.findFirst({ where: eq(employees.userId, userId) }) ?? null;
});
