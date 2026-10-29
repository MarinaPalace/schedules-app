"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { employees, scheduleEntries, swapEvents, swapRequests, timesheetEntries } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import { addDays, isISODate } from "@/lib/calendar";
import { key, loadTimesheet } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { loadPublishedAndLatest, loadPublishedSchedule } from "@/lib/published";
import { canManageDepartment, getCurrentUser, getEmployeeForUser } from "@/lib/session";
import { cellKey, isOpen, samePlan, swapDates } from "@/lib/swap-state";
import { loadSwaps } from "@/lib/swaps";
import { notifySwap } from "@/lib/notify/events";

type Result = { error?: string; ok?: string };

/** How far ahead a swap may be requested. */
const MAX_DAYS_AHEAD = 120;

function revalidate() {
  revalidatePath("/me");
  revalidatePath("/swaps");
  revalidatePath("/schedule");
}

async function me() {
  const user = await getCurrentUser();
  if (!user) throw new AppError("notSignedIn");
  return user;
}

async function myEmployee(userId: string) {
  const emp = await getEmployeeForUser(userId);
  if (!emp || !emp.active) throw new AppError("notLinked");
  return emp;
}

async function loadOne(requestId: string) {
  const [s] = await loadSwaps({ ids: [z.uuid().parse(requestId)] });
  if (!s) throw new AppError("requestNotFound");
  return s;
}

/** Employee asks a colleague to exchange their plans on one or two days. */
export async function requestSwap(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await me();
    const emp = await myEmployee(user.id);
    const colleagueId = z.uuid("swapColleague").parse(form.get("colleagueId"));
    const date1 = String(form.get("date1") ?? "");
    const rawDate2 = String(form.get("date2") ?? "");
    if (!isISODate(date1) || (rawDate2 && !isISODate(rawDate2))) throw new AppError("dateRequired");
    const date2 = rawDate2 && rawDate2 !== date1 ? rawDate2 : null;
    const note = String(form.get("note") ?? "").trim().slice(0, 300) || null;
    const dates = swapDates({ date1, date2 });
    const today = todayISO();
    if (dates[0] < today) throw new AppError("swapPastDay");
    if (dates.at(-1)! > addDays(today, MAX_DAYS_AHEAD)) throw new AppError("swapTooFar");

    const colleague = await db.query.employees.findFirst({ where: eq(employees.id, colleagueId) });
    if (!colleague || !colleague.active || colleague.id === emp.id || colleague.departmentId !== emp.departmentId) throw new AppError("swapColleague");
    if (!colleague.userId) throw new AppError("swapColleagueNoLogin");

    const people = [emp.id, colleague.id];
    const from = dates[0];
    const to = dates.at(-1)!;
    const [timesheet, published, existing] = await Promise.all([
      loadTimesheet(people, from, to),
      loadPublishedSchedule(people, from, to),
      loadSwaps({ departmentIds: [emp.departmentId] }),
    ]);
    if (dates.some((d) => people.some((p) => timesheet.has(key(p, d))))) throw new AppError("swapDayApproved");
    // Leave and sick days belong to the person; only shifts and days off can change hands.
    if (dates.some((d) => people.some((p) => published.get(key(p, d))?.kind === "absence"))) throw new AppError("swapAbsence");
    if (dates.every((d) => samePlan(published.get(key(emp.id, d)), published.get(key(colleague.id, d))))) throw new AppError("swapNothing");
    const clash = existing.some(
      (s) => isOpen(s.status) && [s.requester.id, s.colleague.id].some((p) => people.includes(p)) && s.dates.some((d) => dates.includes(d)),
    );
    if (clash) throw new AppError("swapOverlap");

    const snapshot: Record<string, string | null> = {};
    for (const d of dates) for (const p of people) snapshot[cellKey(p, d)] = published.get(key(p, d))?.id ?? null;

    const [created] = await withActor(user.id, (tx) =>
      tx.insert(swapRequests).values({
        departmentId: emp.departmentId,
        requesterId: emp.id,
        colleagueId: colleague.id,
        date1: dates[0],
        date2: dates[1] ?? null,
        snapshot,
        note,
        createdBy: user.id,
      }).returning({ id: swapRequests.id }),
    );
    notifySwap(created.id, "asked", { userId: user.id });
    revalidate();
    return (await getTranslations("swaps"))("sent", { name: colleague.firstName });
  });
}

/** The colleague accepts (→ goes to the manager) or declines. */
export async function respondSwap(requestId: string, answer: "accepted" | "declined"): Promise<Result> {
  try {
    z.enum(["accepted", "declined"]).parse(answer);
    const user = await me();
    const emp = await myEmployee(user.id);
    const s = await loadOne(requestId);
    if (s.colleague.id !== emp.id) throw new AppError("swapNotYours");
    if (s.status === "expired") throw new AppError("swapExpired");
    if (s.status !== "waiting_colleague") throw new AppError("alreadyDecided");
    await withActor(user.id, (tx) => tx.insert(swapEvents).values({ requestId: s.id, action: answer, createdBy: user.id }));
    notifySwap(s.id, answer, { userId: user.id });
    if (answer === "accepted") notifySwap(s.id, "toApprove", { userId: user.id });
    revalidate();
    return { ok: answer };
  } catch (e) {
    return { error: await failMessage(e) };
  }
}

/** The requester withdraws a request that is still open. */
export async function cancelSwap(requestId: string): Promise<Result> {
  try {
    const user = await me();
    const emp = await myEmployee(user.id);
    const s = await loadOne(requestId);
    if (s.requester.id !== emp.id) throw new AppError("swapNotYours");
    if (!isOpen(s.status)) throw new AppError("alreadyDecided");
    await withActor(user.id, (tx) => tx.insert(swapEvents).values({ requestId: s.id, action: "cancelled", createdBy: user.id }));
    notifySwap(s.id, "cancelled", { userId: user.id });
    revalidate();
    return { ok: "cancelled" };
  } catch (e) {
    return { error: await failMessage(e) };
  }
}

const decisionSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).optional(),
});

/** Department manager (or GM/admin) approves – the plan of both people is exchanged – or rejects. */
export async function decideSwap(raw: unknown): Promise<Result> {
  try {
    const { requestId, decision, note } = decisionSchema.parse(raw);
    const user = await me();
    // Permission checks run before the transaction: never query outside an open transaction.
    const s = await loadOne(requestId);
    if (!(await canManageDepartment(user, s.departmentId))) throw new AppError("cannotDecide");
    if (s.requester.userId === user.id || s.colleague.userId === user.id) throw new AppError("swapOwn");
    if (s.status === "expired") throw new AppError("swapExpired");
    if (s.status !== "waiting_manager") throw new AppError(isOpen(s.status) ? "swapNotWaiting" : "alreadyDecided");

    await withActor(user.id, async (tx) => {
      if (decision === "approved") {
        const people = [s.requester.id, s.colleague.id];
        const approved = await tx
          .select({ id: timesheetEntries.id })
          .from(timesheetEntries)
          .where(and(inArray(timesheetEntries.employeeId, people), inArray(timesheetEntries.workDate, s.dates)));
        if (approved.length) throw new AppError("swapDayApproved");

        // Both people must still have exactly the plan they agreed on – no newer edits, published or not.
        const req = (await tx.select().from(swapRequests).where(eq(swapRequests.id, s.id)))[0];
        const { published, latest } = await loadPublishedAndLatest(people, s.dates[0], s.dates.at(-1)!, tx);
        for (const [k, entryId] of Object.entries(req.snapshot)) {
          if ((published.get(k)?.id ?? null) !== entryId || (latest.get(k)?.id ?? null) !== entryId) throw new AppError("swapStale");
        }

        const ids = s.moves.flatMap((m) => (m.toEntryId ? [m.toEntryId] : []));
        const sources = ids.length ? new Map((await tx.select().from(scheduleEntries).where(inArray(scheduleEntries.id, ids))).map((e) => [e.id, e])) : new Map();
        await tx.insert(scheduleEntries).values(
          s.moves.map((m) => {
            const src = m.toEntryId ? sources.get(m.toEntryId) : null;
            return {
              employeeId: m.employeeId,
              workDate: m.date,
              kind: src?.kind ?? "none",
              shiftTemplateId: src?.shiftTemplateId ?? null,
              absenceCode: src?.absenceCode ?? null,
              segments: src?.segments ?? [],
              breakMinutes: src?.breakMinutes ?? 0,
              paidMinutes: src?.paidMinutes ?? 0,
              departmentId: s.departmentId,
              note: "swap",
              swapRequestId: s.id,
              createdBy: user.id,
            };
          }),
        );
      }
      await tx.insert(swapEvents).values({ requestId: s.id, action: decision, note: note || null, createdBy: user.id });
    });
    notifySwap(s.id, decision, { userId: user.id });
    revalidate();
    return { ok: decision };
  } catch (e) {
    return { error: await failMessage(e) };
  }
}

/** A unique-index hit means someone else answered first. */
async function failMessage(e: unknown) {
  const err = e as { cause?: { code?: string } };
  if (err.cause?.code === "23505") return errorMessage(new AppError("alreadyDecided"));
  return errorMessage(e);
}
