"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { employees, scheduleEntries, schedulePublications, shiftTemplates } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { AppError } from "@/lib/app-error";
import { addDays, dateRange, isISODate } from "@/lib/calendar";
import { isAbsenceCode, type DayValue } from "@/lib/codes";
import { loadSchedule } from "@/lib/data";
import { errorMessage } from "@/lib/errors";
import { canManageDepartment, getCurrentUser } from "@/lib/session";
import { paidMinutes, parseSegments } from "@/lib/shifts";

const toolSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("template"), templateId: z.uuid() }),
  z.object({ type: z.literal("off") }),
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("absence"), code: z.string() }),
  z.object({ type: z.literal("custom"), text: z.string() }),
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
          const segments = parseSegments(tool.text);
          if (!segments) throw new AppError("hoursFormat");
          value = { kind: "shift", segments, paidMinutes: paidMinutes(segments) };
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
        segments: value.segments,
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
      const found = await tx.select({ id: employees.id }).from(employees).where(inArray(employees.id, empIds));
      if (found.length !== empIds.length) throw new AppError("unknownEmployee");
      await tx.insert(scheduleEntries).values(rows);
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
    await withActor(me.id, (tx) => tx.insert(schedulePublications).values({ departmentId, fromDate: from, toDate: to, createdBy: me.id }));
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
