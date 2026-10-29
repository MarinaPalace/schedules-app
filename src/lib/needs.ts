import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { employees, jobRoles, locations, seasons, staffingPlanRows, staffingPlans } from "@/db/schema";
import { addDays, dateRange, monthBounds } from "@/lib/calendar";
import { dayBlocks, type Block } from "@/lib/coverage";
import { key, loadDepartmentEmployees, loadRates, loadSchedule } from "@/lib/data";
import { currentPlans, dayGaps, neededMinutes, planFor, type Applied, type NeedPlan, type NeedRow, type SeasonLite } from "@/lib/needs-rules";
import { rateAt } from "@/lib/rates";

export async function loadSeasons(): Promise<SeasonLite[]> {
  return db.select({ id: seasons.id, name: seasons.name, fromDate: seasons.fromDate, toDate: seasons.toDate, active: seasons.active }).from(seasons).orderBy(asc(seasons.fromDate));
}

/** Current needs rules (latest version per scope) of these locations. */
export async function loadPlans(locationIds: string[]): Promise<NeedPlan[]> {
  if (!locationIds.length) return [];
  const plans = await db.select().from(staffingPlans).where(inArray(staffingPlans.locationId, locationIds));
  if (!plans.length) return [];
  const rows = await db.select().from(staffingPlanRows).where(inArray(staffingPlanRows.planId, plans.map((p) => p.id)));
  return currentPlans(
    plans.map((p) => ({
      id: p.id,
      locationId: p.locationId,
      weekdays: p.weekdays,
      seasonId: p.seasonId,
      onDate: p.onDate,
      note: p.note,
      createdAt: p.createdAt.toISOString(),
      rows: rows
        .filter((r) => r.planId === p.id)
        .map((r) => ({ from: r.fromTime, to: r.toTime, roleId: r.roleId, count: r.count }))
        .sort((a, b) => a.from.localeCompare(b.from)),
    })),
  );
}

export type DayNeeds = Record<string, { rows: NeedRow[]; rule: Omit<Applied, "plan"> & { planId: string } }>;

/** Per date and location: the rows of the rule that applies (one date › season › all year). */
export async function needsForDates(departmentIds: string[], dates: string[]): Promise<Record<string, DayNeeds>> {
  const places = departmentIds.length ? await db.select({ id: locations.id }).from(locations).where(and(inArray(locations.departmentId, departmentIds), eq(locations.active, true))) : [];
  const [plans, ss] = await Promise.all([loadPlans(places.map((p) => p.id)), loadSeasons()]);
  const out: Record<string, DayNeeds> = {};
  for (const d of dates) {
    out[d] = {};
    for (const l of places) {
      const a = planFor(
        plans.filter((p) => p.locationId === l.id),
        d,
        ss,
      );
      if (a) out[d][l.id] = { rows: a.plan.rows, rule: { kind: a.kind, seasonName: a.seasonName, planId: a.plan.id } };
    }
  }
  return out;
}

export type GapLine = { date: string; departmentId: string; locationId: string; locationCode: string; locationName: string; roleName: string; from: string; to: string; missing: number };

/** Where the current plan (incl. unpublished changes) is short of the needs, day by day. */
export async function departmentGaps(departmentIds: string[], from: string, to: string): Promise<GapLine[]> {
  if (!departmentIds.length) return [];
  const dates = dateRange(from, to);
  const [needs, places, roles] = await Promise.all([
    needsForDates(departmentIds, dates),
    db.select().from(locations).where(inArray(locations.departmentId, departmentIds)),
    db.select().from(jobRoles).where(inArray(jobRoles.departmentId, departmentIds)),
  ]);
  if (!Object.values(needs).some((d) => Object.keys(d).length)) return [];
  const out: GapLine[] = [];
  for (const deptId of departmentIds) {
    const people = await loadDepartmentEmployees(deptId, addDays(from, -1), to);
    const plan = await loadSchedule(
      people.map((p) => p.id),
      addDays(from, -1),
      to,
    );
    const dayOf = (e: (typeof people)[number], d: string) => {
      const x = plan.get(key(e.id, d));
      return x && x.kind === "shift" ? { segments: x.segments, roleId: x.jobRoleId ?? (e.departmentId === deptId ? e.jobRoleId : null) } : undefined;
    };
    for (const d of dates) {
      const own: Record<string, NeedRow[]> = {};
      for (const [locId, n] of Object.entries(needs[d] ?? {})) if (places.find((l) => l.id === locId)?.departmentId === deptId) own[locId] = n.rows;
      if (!Object.keys(own).length) continue;
      const blocks: Block[][] = people.map((e) => dayBlocks(dayOf(e, d), dayOf(e, addDays(d, -1))));
      for (const g of dayGaps(blocks, own).missing) {
        const l = places.find((x) => x.id === g.locationId)!;
        out.push({ date: d, departmentId: deptId, locationId: l.id, locationCode: l.code, locationName: l.name, roleName: roles.find((r) => r.id === g.roleId)?.name ?? "?", from: g.from, to: g.to, missing: g.missing });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.locationCode.localeCompare(b.locationCode) || a.from.localeCompare(b.from));
}

/**
 * What a month of needs would cost: needed hours × the average pay of people in that role
 * (department average when nobody has the role yet), as pay and as total cost.
 */
export async function needsCost(departmentIds: string[], month: string, factor: number) {
  const { from, to } = monthBounds(month);
  const dates = dateRange(from, to);
  const [needs, places, staff] = await Promise.all([
    needsForDates(departmentIds, dates),
    departmentIds.length ? db.select().from(locations).where(inArray(locations.departmentId, departmentIds)) : Promise.resolve([]),
    departmentIds.length ? db.select().from(employees).where(and(inArray(employees.departmentId, departmentIds), eq(employees.active, true))) : Promise.resolve([]),
  ]);
  const rates = await loadRates(staff.map((s) => s.id));
  const result = new Map<string, { minutes: number; payCents: number; costCents: number }>();
  for (const deptId of departmentIds) {
    const people = staff.filter((s) => s.departmentId === deptId);
    const avg = (roleId: string | null) => {
      const group = people.filter((p) => !roleId || p.jobRoleId === roleId).map((p) => rateAt(rates, p.id, from)).filter((r) => r > 0);
      return group.length ? group.reduce((a, b) => a + b, 0) / group.length : 0;
    };
    const deptAvg = avg(null);
    let minutes = 0;
    let pay = 0;
    for (const d of dates) {
      for (const [locId, n] of Object.entries(needs[d] ?? {})) {
        if (places.find((l) => l.id === locId)?.departmentId !== deptId) continue;
        for (const [roleId, m] of neededMinutes(n.rows)) {
          minutes += m;
          pay += (m / 60) * (avg(roleId) || deptAvg);
        }
      }
    }
    if (minutes) result.set(deptId, { minutes, payCents: Math.round(pay), costCents: Math.round(pay * factor) });
  }
  return result;
}
