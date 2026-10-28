"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { advanceDecisions, advanceRequests, employees } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { AppError } from "@/lib/app-error";
import { errorMessage } from "@/lib/errors";
import { parseEurToCents } from "@/lib/money";
import { canManageDepartment, getCurrentUser, getEmployeeForUser } from "@/lib/session";

function amountFrom(form: FormData): number {
  const cents = parseEurToCents(String(form.get("amount") ?? ""));
  if (cents === null || cents <= 0) throw new AppError("amountFormat");
  if (cents > 1_000_000) throw new AppError("amountTooHigh");
  return cents;
}

/** Employee asks for an advance for themselves. */
export async function requestOwnAdvance(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await getCurrentUser();
    if (!me) throw new AppError("notSignedIn");
    const emp = await getEmployeeForUser(me.id);
    if (!emp) throw new AppError("notLinked");
    const amountCents = amountFrom(form);
    const note = String(form.get("note") ?? "").trim() || null;
    await withActor(me.id, (tx) => tx.insert(advanceRequests).values({ employeeId: emp.id, amountCents, note, createdBy: me.id }));
    revalidatePath("/me");
    revalidatePath("/advances");
    return (await getTranslations("advances"))("sent");
  });
}

/** Manager files a request on behalf of an employee of their department. */
export async function requestAdvanceFor(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await getCurrentUser();
    if (!me) throw new AppError("notSignedIn");
    const employeeId = z.uuid("unknownEmployee").parse(form.get("employeeId"));
    const emp = await db.query.employees.findFirst({ where: eq(employees.id, employeeId) });
    if (!emp || !(await canManageDepartment(me, emp.departmentId))) throw new AppError("cannotRequestFor");
    const amountCents = amountFrom(form);
    const note = String(form.get("note") ?? "").trim() || null;
    await withActor(me.id, (tx) => tx.insert(advanceRequests).values({ employeeId, amountCents, note, createdBy: me.id }));
    revalidatePath("/advances");
    return (await getTranslations("advances"))("createdFor", { name: `${emp.firstName} ${emp.lastName}` });
  });
}

const decisionSchema = z.object({
  requestId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).optional(),
});

export async function decideAdvance(raw: unknown): Promise<{ error?: string; ok?: string }> {
  try {
    const { requestId, decision, note } = decisionSchema.parse(raw);
    const me = await getCurrentUser();
    if (!me) throw new AppError("notSignedIn");
    // Permission checks run before the transaction: never query outside an open transaction.
    const req = await db.query.advanceRequests.findFirst({ where: eq(advanceRequests.id, requestId) });
    if (!req) throw new AppError("requestNotFound");
    const emp = await db.query.employees.findFirst({ where: eq(employees.id, req.employeeId) });
    if (!emp || !(await canManageDepartment(me, emp.departmentId))) throw new AppError("cannotDecide");
    if (emp.userId === me.id) throw new AppError("ownAdvance");
    await withActor(me.id, async (tx) => {
      const done = await tx.query.advanceDecisions.findFirst({ where: eq(advanceDecisions.requestId, requestId) });
      if (done) throw new AppError("alreadyDecided");
      await tx.insert(advanceDecisions).values({ requestId, decision, note: note || null, createdBy: me.id });
    });
    revalidatePath("/advances");
    revalidatePath("/me");
    return { ok: decision };
  } catch (e) {
    return { error: await errorMessage(e) };
  }
}
