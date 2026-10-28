"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { advanceDecisions, advanceRequests, employees } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { parseEurToCents } from "@/lib/money";
import { canManageDepartment, getCurrentUser, getEmployeeForUser } from "@/lib/session";

function amountFrom(form: FormData): number {
  const cents = parseEurToCents(String(form.get("amount") ?? ""));
  if (cents === null || cents <= 0) throw new Error("Enter an amount, e.g. 200");
  if (cents > 1_000_000) throw new Error("Amount looks too high");
  return cents;
}

/** Employee asks for an advance for themselves. */
export async function requestOwnAdvance(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await getCurrentUser();
    if (!me) throw new Error("Not signed in");
    const emp = await getEmployeeForUser(me.id);
    if (!emp) throw new Error("Your login is not linked to an employee record");
    const amountCents = amountFrom(form);
    const note = String(form.get("note") ?? "").trim() || null;
    await withActor(me.id, (tx) => tx.insert(advanceRequests).values({ employeeId: emp.id, amountCents, note, createdBy: me.id }));
    revalidatePath("/me");
    revalidatePath("/advances");
    return "Request sent to your manager";
  });
}

/** Manager files a request on behalf of an employee of their department. */
export async function requestAdvanceFor(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await getCurrentUser();
    if (!me) throw new Error("Not signed in");
    const employeeId = z.uuid("Choose an employee").parse(form.get("employeeId"));
    const emp = await withActor(me.id, (tx) => tx.query.employees.findFirst({ where: eq(employees.id, employeeId) }));
    if (!emp || !(await canManageDepartment(me, emp.departmentId))) throw new Error("You cannot request for this employee");
    const amountCents = amountFrom(form);
    const note = String(form.get("note") ?? "").trim() || null;
    await withActor(me.id, (tx) => tx.insert(advanceRequests).values({ employeeId, amountCents, note, createdBy: me.id }));
    revalidatePath("/advances");
    return `Request for ${emp.firstName} ${emp.lastName} created`;
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
    if (!me) throw new Error("Not signed in");
    // Permission checks run before the transaction: never query outside an open transaction.
    const req = await db.query.advanceRequests.findFirst({ where: eq(advanceRequests.id, requestId) });
    if (!req) throw new Error("Request not found");
    const emp = await db.query.employees.findFirst({ where: eq(employees.id, req.employeeId) });
    if (!emp || !(await canManageDepartment(me, emp.departmentId))) throw new Error("You cannot decide this request");
    if (emp.userId === me.id) throw new Error("You cannot decide your own advance");
    await withActor(me.id, async (tx) => {
      const done = await tx.query.advanceDecisions.findFirst({ where: eq(advanceDecisions.requestId, requestId) });
      if (done) throw new Error(`Already ${done.decision}`);
      await tx.insert(advanceDecisions).values({ requestId, decision, note: note || null, createdBy: me.id });
    });
    revalidatePath("/advances");
    revalidatePath("/me");
    return { ok: decision };
  } catch (e) {
    const err = e as { message?: string; issues?: { message: string }[] };
    return { error: err.issues?.[0]?.message ?? err.message };
  }
}
