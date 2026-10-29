import "server-only";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { budgets, departmentManagers, departments, employees, jobRoles, locations, schedulePublications, scheduleEntries, shiftTemplates, staffingPlans, user } from "@/db/schema";
import { monthOf } from "@/lib/calendar";
import { todayISO } from "@/lib/dates";
import { loginStatuses } from "@/lib/login-status";
import { emailConfigured, telegramConfigured } from "@/lib/notify/channels";
import { getHotelName } from "@/lib/settings";

/** How far one department is with its set-up (used by the checklists and the GM's progress board). */
export type DeptProgress = {
  id: string;
  name: string;
  managers: number;
  managersActive: number;
  managerNames: string[];
  locations: number;
  roles: number;
  needs: number;
  legends: number;
  staff: number;
  logins: number;
  loginsActive: number;
  scheduled: boolean;
  published: boolean;
};

const byDept = (rows: { departmentId: string; n: number }[]) => new Map(rows.map((r) => [r.departmentId, Number(r.n)]));

export async function departmentProgress(departmentIds?: string[]): Promise<DeptProgress[]> {
  const deps = await db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.active, true), departmentIds ? inArray(departments.id, departmentIds.length ? departmentIds : ["00000000-0000-0000-0000-000000000000"]) : undefined))
    .orderBy(departments.name);
  const ids = deps.map((d) => d.id);
  if (!ids.length) return [];
  const [mgrs, locs, roles, plans, hotelLegends, legends, staff, sched, pubs] = await Promise.all([
    db
      .select({ departmentId: departmentManagers.departmentId, userId: departmentManagers.userId, name: user.name })
      .from(departmentManagers)
      .innerJoin(user, eq(user.id, departmentManagers.userId))
      .where(and(inArray(departmentManagers.departmentId, ids), eq(departmentManagers.active, true), eq(user.active, true))),
    db.select({ departmentId: locations.departmentId, n: count() }).from(locations).where(and(inArray(locations.departmentId, ids), eq(locations.active, true))).groupBy(locations.departmentId),
    db.select({ departmentId: jobRoles.departmentId, n: count() }).from(jobRoles).where(and(inArray(jobRoles.departmentId, ids), eq(jobRoles.active, true))).groupBy(jobRoles.departmentId),
    db
      .select({ departmentId: locations.departmentId, n: count() })
      .from(staffingPlans)
      .innerJoin(locations, eq(locations.id, staffingPlans.locationId))
      .where(inArray(locations.departmentId, ids))
      .groupBy(locations.departmentId),
    db.select({ n: count() }).from(shiftTemplates).where(and(eq(shiftTemplates.active, true), isNull(shiftTemplates.departmentId))),
    db
      .select({ departmentId: shiftTemplates.departmentId, n: count() })
      .from(shiftTemplates)
      .where(and(eq(shiftTemplates.active, true), inArray(shiftTemplates.departmentId, ids)))
      .groupBy(shiftTemplates.departmentId),
    db.select({ id: employees.id, departmentId: employees.departmentId, userId: employees.userId }).from(employees).where(and(inArray(employees.departmentId, ids), eq(employees.active, true))),
    db.select({ departmentId: scheduleEntries.departmentId, n: count() }).from(scheduleEntries).where(inArray(scheduleEntries.departmentId, ids)).groupBy(scheduleEntries.departmentId),
    db.select({ departmentId: schedulePublications.departmentId, n: count() }).from(schedulePublications).where(inArray(schedulePublications.departmentId, ids)).groupBy(schedulePublications.departmentId),
  ]);
  const status = await loginStatuses([...new Set([...mgrs.map((m) => m.userId), ...staff.flatMap((s) => (s.userId ? [s.userId] : []))])]);
  const [L, R, P, S, PB] = [byDept(locs), byDept(roles), byDept(plans), byDept(sched), byDept(pubs)];
  const G = new Map(legends.map((l) => [l.departmentId!, Number(l.n)]));
  const hotelWide = Number(hotelLegends[0]?.n ?? 0);
  return deps.map((d) => {
    const m = mgrs.filter((x) => x.departmentId === d.id);
    const people = staff.filter((s) => s.departmentId === d.id);
    const withLogin = people.filter((p) => p.userId);
    return {
      ...d,
      managers: m.length,
      managersActive: m.filter((x) => status.get(x.userId) === "active").length,
      managerNames: m.map((x) => x.name),
      locations: L.get(d.id) ?? 0,
      roles: R.get(d.id) ?? 0,
      needs: P.get(d.id) ?? 0,
      legends: (G.get(d.id) ?? 0) + hotelWide,
      staff: people.length,
      logins: withLogin.length,
      loginsActive: withLogin.filter((p) => status.get(p.userId!) === "active").length,
      scheduled: (S.get(d.id) ?? 0) > 0,
      published: (PB.get(d.id) ?? 0) > 0,
    };
  });
}

/** Hotel-level steps for owner and GM. */
export async function hotelProgress() {
  const month = monthOf(todayISO());
  const [name, gm, accountant, deps, withBudget] = await Promise.all([
    getHotelName(),
    db.select({ n: count() }).from(user).where(and(eq(user.role, "top_manager"), eq(user.active, true))),
    db.select({ n: count() }).from(user).where(and(eq(user.role, "accountant"), eq(user.active, true))),
    departmentProgress(),
    db.selectDistinct({ id: budgets.departmentId }).from(budgets).where(eq(budgets.month, `${month}-01`)),
  ]);
  return {
    hotelName: !!name,
    gm: Number(gm[0]?.n ?? 0) > 0,
    accountant: Number(accountant[0]?.n ?? 0) > 0,
    departments: deps.length,
    departmentsWithManager: deps.filter((d) => d.managers > 0).length,
    departmentsReady: deps.filter((d) => d.locations > 0 && d.roles > 0 && d.staff > 0).length,
    budgets: deps.filter((d) => withBudget.some((b) => b.id === d.id)).length,
    notifications: emailConfigured() || telegramConfigured(),
    deps,
  };
}

/** Owner/GM accounts: does the given user have email or Telegram? */
export async function hasChannel(userId: string) {
  const u = await db.query.user.findFirst({ where: eq(user.id, userId), columns: { contactEmail: true, telegramChatId: true } });
  return !!(u?.contactEmail || u?.telegramChatId);
}

