"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { employees, jobRoles, locations, scheduleEntries, schedulePublications, shiftTemplates } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { AppError } from "@/lib/app-error";
import { addDays, dateRange, isISODate } from "@/lib/calendar";
import { isAbsenceCode, type DayValue } from "@/lib/codes";
import { loadSchedule } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { notifyPublished } from "@/lib/notify/events";
import { loadUnpublishedEmployees } from "@/lib/published";
import { errorMessage } from "@/lib/errors";
import { canManageDepartment, getCurrentUser } from "@/lib/session";
import { legendFields, legendHours } from "@/lib/legend-input";
import { placeBlocks, type TemplateLite } from "@/lib/cell-view";

// Place per block (one = all blocks) and role for the shift; left out = the person's usual place/role.
const placed = {
  locations: z.array(z.uuid().nullable()).min(1).max(8).optional(),
  roleId: z.uuid().nullable().optional(),
};
const toolSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("template"), templateId: z.uuid(), ...placed }),
  z.object({ type: z.literal("off") }),
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("absence"), code: z.string() }),
  z.object({ type: z.literal("custom"), text: z.string(), breakMinutes: z.number().int().min(0).max(240).optional(), ...placed }),
]);
export type Tool = z.infer<typeof toolSchema>;

const cellsSchema = z
  .array(
    z.object({
      employeeId: z.uuid(),
      date: z.string().refine(isISODate, "invalid"),
      tool: toolSchema,
    }),
  )
  .min(1)
  .max(2000);

async function authorize(departmentId: string) {
  const me = await getCurrentUser();
  if (!me || !(await canManageDepartment(me, departmentId))) throw new AppError("cannotEditSchedule");
  return me;
}

export async function saveCells(departmentId: string, input: unknown): Promise<{ error?: string }> {
  try {
    z.uuid().parse(departmentId);
    const me = await authorize(departmentId);
    const cells = cellsSchema.parse(input);

    const templateIds = [...new Set(cells.flatMap((c) => (c.tool.type === "template" ? [c.tool.templateId] : [])))];
    const templates = templateIds.length
      ? new Map((await withActor(me.id, (tx) => tx.select().from(shiftTemplates).where(inArray(shiftTemplates.id, templateIds)))).map((t) => [t.id, t]))
      : new Map();

    const rows = cells.map(({ employeeId, date, tool }) => {
      const usual = { locations: undefined as (string | null)[] | undefined, roleId: undefined as string | null | undefined };
      if (tool.type === "template" || tool.type === "custom") Object.assign(usual, { locations: tool.locations, roleId: tool.roleId });
      let value: DayValue;
      switch (tool.type) {
        case "template": {
          const t = templates.get(tool.templateId);
          if (!t || !t.active) throw new AppError("unknownLegend");
          if (t.departmentId && t.departmentId !== departmentId) throw new AppError("legendOtherDept", { code: t.code });
          value = { kind: "shift", segments: t.segments, paidMinutes: t.paidMinutes, breakMinutes: t.breakMinutes, shiftTemplateId: t.id };
          break;
        }
        case "custom": {
          const breakMinutes = tool.breakMinutes ?? 0;
          value = { kind: "shift", ...legendHours(tool.text, breakMinutes), breakMinutes };
          break;
        }
        case "absence":
          if (!isAbsenceCode(tool.code)) throw new AppError("chooseAbsence");
          value = { kind: "absence", segments: [], paidMinutes: 0, absenceCode: tool.code };
          break;
        default:
          value = { kind: tool.type, segments: [], paidMinutes: 0 };
      }
      return {
        employeeId,
        workDate: date,
        kind: value.kind,
        segments: value.kind === "shift" ? placeBlocks(value.segments, usual.locations) : value.segments,
        /** Filled in below: undefined = the person's usual role/place. */
        jobRoleId: value.kind === "shift" ? usual.roleId : null,
        usualPlace: value.kind === "shift" && !usual.locations,
        breakMinutes: value.breakMinutes ?? 0,
        paidMinutes: value.paidMinutes,
        shiftTemplateId: value.shiftTemplateId ?? null,
        absenceCode: value.absenceCode ?? null,
        departmentId,
        createdBy: me.id,
      };
    });

    await withActor(me.id, async (tx) => {
      const empIds = [...new Set(rows.map((r) => r.employeeId))];
      const found = new Map(
        (await tx.select({ id: employees.id, departmentId: employees.departmentId, jobRoleId: employees.jobRoleId, homeLocationId: employees.homeLocationId }).from(employees).where(inArray(employees.id, empIds))).map(
          (e) => [e.id, e],
        ),
      );
      if (found.size !== empIds.length) throw new AppError("unknownEmployee");
      // Places and roles must belong to this department.
      const placeIds = [...new Set(rows.flatMap((r) => r.segments.map((s) => s.locationId).filter((x): x is string => !!x)))];
      const roleIds = [...new Set(rows.map((r) => r.jobRoleId).filter((x): x is string => !!x))];
      const okPlaces = placeIds.length ? await tx.select({ id: locations.id }).from(locations).where(and(inArray(locations.id, placeIds), eq(locations.departmentId, departmentId))) : [];
      const okRoles = roleIds.length ? await tx.select({ id: jobRoles.id }).from(jobRoles).where(and(inArray(jobRoles.id, roleIds), eq(jobRoles.departmentId, departmentId))) : [];
      if (okPlaces.length !== placeIds.length || okRoles.length !== roleIds.length) throw new AppError("otherDepartment");
      await tx.insert(scheduleEntries).values(
        rows.map(({ usualPlace, ...r }) => {
          const emp = found.get(r.employeeId)!;
          // Usual place/role only count in the person's own department (someone lent to another one has none there).
          const own = emp.departmentId === departmentId;
          return {
            ...r,
            segments: usualPlace ? placeBlocks(r.segments, [own ? emp.homeLocationId : null]) : r.segments,
            jobRoleId: r.jobRoleId === undefined ? (own ? emp.jobRoleId : null) : r.jobRoleId,
          };
        }),
      );
    });
    // No revalidatePath here: the board keeps its own state, and a refresh would reset it mid-edit.
    return {};
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}

/** Makes the current plan of a period visible to employees. */
export async function publishSchedule(departmentId: string, from: string, to: string): Promise<{ error?: string }> {
  try {
    z.uuid().parse(departmentId);
    if (!isISODate(from) || !isISODate(to) || from > to) throw new AppError("invalidPeriod");
    const me = await authorize(departmentId);
    // Only coming days are worth a message; people whose plan doesn't change get none.
    const today = todayISO();
    const start = from > today ? from : today;
    const changed = await loadUnpublishedEmployees(departmentId, start, to);
    await withActor(me.id, (tx) => tx.insert(schedulePublications).values({ departmentId, fromDate: from, toDate: to, createdBy: me.id }));
    if (start <= to) notifyPublished(changed, start, to);
    revalidatePath("/schedule");
    revalidatePath("/me");
    return {};
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}

/** Copies the current plan of the previous week onto the given week (for the given employees). */
export async function copyPreviousWeek(departmentId: string, monday: string, employeeIds: string[]): Promise<{ error?: string; copied?: number }> {
  try {
    z.uuid().parse(departmentId);
    if (!isISODate(monday)) throw new AppError("invalidPeriod");
    z.array(z.uuid()).parse(employeeIds);
    const me = await authorize(departmentId);
    const source = await loadSchedule(employeeIds, addDays(monday, -7), addDays(monday, -1));
    const rows = [...source.values()]
      .filter((e) => e.kind !== "none")
      .map((e) => ({
        employeeId: e.employeeId,
        workDate: addDays(e.workDate, 7),
        kind: e.kind,
        segments: e.segments,
        breakMinutes: e.breakMinutes,
        paidMinutes: e.paidMinutes,
        shiftTemplateId: e.shiftTemplateId,
        absenceCode: e.absenceCode,
        jobRoleId: e.jobRoleId,
        departmentId,
        note: "copied from previous week",
        createdBy: me.id,
      }));
    if (!rows.length) throw new AppError("nothingToCopy");
    // Only active employees still in this department.
    await withActor(me.id, async (tx) => {
      const ok = new Set(
        (
          await tx
            .select({ id: employees.id })
            .from(employees)
            .where(and(eq(employees.departmentId, departmentId), eq(employees.active, true), inArray(employees.id, employeeIds)))
        ).map((e) => e.id),
      );
      const week = dateRange(monday, addDays(monday, 6));
      const filtered = rows.filter((r) => ok.has(r.employeeId) && week.includes(r.workDate));
      if (filtered.length) await tx.insert(scheduleEntries).values(filtered);
    });
    revalidatePath("/schedule");
    return { copied: rows.length };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}

/**
 * "Save as legend" from the schedule: a new shift legend for this department (managers may create them
 * for their own departments; admins also on the Legends page). Returns it so the board can use it at once.
 */
export async function createDepartmentLegend(departmentId: string, input: unknown): Promise<{ error?: string; template?: TemplateLite }> {
  try {
    z.uuid().parse(departmentId);
    const me = await authorize(departmentId);
    const raw = z.object({ text: z.string() }).passthrough().parse(input);
    const data = legendFields.parse(raw);
    const hours = legendHours(raw.text, data.breakMinutes);
    const [t] = await withActor(me.id, (tx) => tx.insert(shiftTemplates).values({ ...data, ...hours, departmentId }).returning());
    // No revalidatePath: it would refresh the board mid-edit and drop the cell that is about to get this legend.
    return { template: { id: t.id, code: t.code, name: t.name, color: t.color, segments: t.segments, paidMinutes: t.paidMinutes, breakMinutes: t.breakMinutes } };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}
