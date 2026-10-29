"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { correctionDecisions, correctionRequests, employees, timesheetEntries } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { isISODate } from "@/lib/calendar";
import { todayISO } from "@/lib/dates";
import { dayInputSchema, sameDay, toDayValue } from "@/lib/day-input";
import { assertRole, canManageDepartment, getCurrentUser } from "@/lib/session";
import { AppError } from "@/lib/app-error";
import { errorMessage } from "@/lib/errors";
import { getTranslations } from "next-intl/server";
import { notifyCorrectionDecided, notifyCorrectionRequested } from "@/lib/notify/events";

type Result = { error?: string; ok?: string };

async function fail(e: unknown): Promise<Result> {
  const err = e as { cause?: { code?: string } };
  if (err.cause?.code === "23505") return { error: await errorMessage(new AppError("approvedMeanwhile")) };
  return { error: await errorMessage(e) };
}

async function authorize(departmentId: string) {
  const me = await getCurrentUser();
  if (!me || !(await canManageDepartment(me, departmentId))) throw new AppError("cannotApprove");
  return me;
}

const approveSchema = z.object({
  departmentId: z.uuid(),
  date: z.string().refine(isISODate, "invalid"),
  rows: z.array(z.object({ employeeId: z.uuid(), input: dayInputSchema })).min(1),
});

/** Approves (locks) the given employee-days. Days already approved are rejected. */
export async function approveDay(raw: unknown): Promise<Result> {
  try {
    const { departmentId, date, rows } = approveSchema.parse(raw);
    if (date > todayISO()) throw new AppError("futureDays");
    const me = await authorize(departmentId);

    const values = rows.map(({ employeeId, input }) => {
      const v = toDayValue(input);
      if (typeof v === "string") throw new AppError(v);
      return { employeeId, v };
    });

    await withActor(me.id, async (tx) => {
      const ids = values.map((r) => r.employeeId);
      const known = await tx.select({ id: employees.id }).from(employees).where(inArray(employees.id, ids));
      if (known.length !== new Set(ids).size) throw new AppError("unknownEmployee");
      const existing = await tx
        .select({ id: timesheetEntries.employeeId })
        .from(timesheetEntries)
        .where(and(eq(timesheetEntries.workDate, date), inArray(timesheetEntries.employeeId, ids)));
      if (existing.length) throw new AppError("alreadyApproved");
      await tx.insert(timesheetEntries).values(
        values.map(({ employeeId, v }) => ({
          employeeId,
          workDate: date,
          version: 1,
          kind: v.kind,
          absenceCode: v.absenceCode ?? null,
          segments: v.segments,
          breakMinutes: v.breakMinutes ?? 0,
          paidMinutes: v.paidMinutes,
          departmentId,
          createdBy: me.id,
        })),
      );
    });
    revalidatePath("/timesheet");
    return { ok: (await getTranslations("timesheet"))("approvedCount", { count: values.length }) };
  } catch (e) {
    return await fail(e);
  }
}

const correctionSchema = z.object({
  departmentId: z.uuid(),
  employeeId: z.uuid(),
  date: z.string().refine(isISODate, "invalid"),
  input: dayInputSchema,
  reason: z.string().trim().min(3, "reasonRequired"),
});

/** Changing an approved day goes to the top manager for approval. */
export async function requestCorrection(raw: unknown): Promise<Result> {
  try {
    const { departmentId, employeeId, date, input, reason } = correctionSchema.parse(raw);
    const me = await authorize(departmentId);
    const v = toDayValue(input);
    if (typeof v === "string") throw new AppError(v);

    await withActor(me.id, async (tx) => {
      const [current] = await tx
        .select()
        .from(timesheetEntries)
        .where(and(eq(timesheetEntries.employeeId, employeeId), eq(timesheetEntries.workDate, date)))
        .orderBy(desc(timesheetEntries.version))
        .limit(1);
      if (!current) throw new AppError("notApprovedYet");
      if (sameDay(v, current)) throw new AppError("nothingChanged");
      const pending = await tx
        .select({ id: correctionRequests.id })
        .from(correctionRequests)
        .leftJoin(correctionDecisions, eq(correctionDecisions.requestId, correctionRequests.id))
        .where(and(eq(correctionRequests.employeeId, employeeId), eq(correctionRequests.workDate, date), isNull(correctionDecisions.id)));
      if (pending.length) throw new AppError("correctionPending");
      await tx.insert(correctionRequests).values({
        employeeId,
        workDate: date,
        baseTimesheetId: current.id,
        kind: v.kind,
        absenceCode: v.absenceCode ?? null,
        segments: v.segments,
        breakMinutes: v.breakMinutes ?? 0,
        paidMinutes: v.paidMinutes,
        reason,
        createdBy: me.id,
      });
    });
    notifyCorrectionRequested(employeeId, date, me.id);
    revalidatePath("/timesheet");
    revalidatePath("/corrections");
    return { ok: (await getTranslations("timesheet"))("sentForApproval") };
  } catch (e) {
    return await fail(e);
  }
}

const decisionSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).optional(),
});

export async function decideCorrection(raw: unknown): Promise<Result> {
  try {
    const { requestId, decision, note } = decisionSchema.parse(raw);
    const me = await assertRole(["top_manager", "admin"]);

    const decided = await withActor(me.id, async (tx) => {
      const req = await tx.query.correctionRequests.findFirst({ where: eq(correctionRequests.id, requestId) });
      if (!req) throw new AppError("requestNotFound");
      const done = await tx.query.correctionDecisions.findFirst({ where: eq(correctionDecisions.requestId, requestId) });
      if (done) throw new AppError("alreadyDecided");

      if (decision === "approved") {
        const [current] = await tx
          .select()
          .from(timesheetEntries)
          .where(and(eq(timesheetEntries.employeeId, req.employeeId), eq(timesheetEntries.workDate, req.workDate)))
          .orderBy(desc(timesheetEntries.version))
          .limit(1);
        if (current.id !== req.baseTimesheetId) throw new AppError("dayChanged");
        await tx.insert(timesheetEntries).values({
          employeeId: req.employeeId,
          workDate: req.workDate,
          version: current.version + 1,
          kind: req.kind,
          absenceCode: req.absenceCode,
          segments: req.segments,
          breakMinutes: req.breakMinutes,
          paidMinutes: req.paidMinutes,
          departmentId: current.departmentId,
          correctionRequestId: req.id,
          note: req.reason,
          createdBy: me.id,
        });
      }
      await tx.insert(correctionDecisions).values({ requestId, decision, note: note || null, createdBy: me.id });
      const emp = await tx.query.employees.findFirst({ where: eq(employees.id, req.employeeId) });
      return { by: req.createdBy, name: emp ? `${emp.firstName} ${emp.lastName}` : "", date: req.workDate };
    });
    notifyCorrectionDecided(decided.by, decided.name, decided.date, decision);
    revalidatePath("/corrections");
    revalidatePath("/timesheet");
    const t = await getTranslations("corrections");
    return { ok: decision === "approved" ? t("approvedNew") : t("rejectedDone") };
  } catch (e) {
    return await fail(e);
  }
}
