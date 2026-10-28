"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { shiftTemplates } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { assertRole } from "@/lib/session";
import { formatHours, paidMinutes, parseSegments } from "@/lib/shifts";

const ADMINS = ["admin", "top_manager"] as const;

const fields = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(6, "Code: max 6 characters")
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "Name is required"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid colour"),
  breakMinutes: z.coerce.number().int().min(0).max(240),
  departmentId: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(z.uuid().nullable()),
});

function parse(form: FormData) {
  const data = fields.parse(Object.fromEntries(form));
  const segments = parseSegments(String(form.get("segments") ?? ""));
  if (!segments) throw new Error('Hours must look like "09:00-11:00 / 15:00-20:00"');
  const paid = paidMinutes(segments, data.breakMinutes);
  if (paid <= 0) throw new Error("Break is longer than the shift");
  return { ...data, segments, paidMinutes: paid };
}

export async function createShift(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const data = parse(form);
    await withActor(me.id, (tx) => tx.insert(shiftTemplates).values(data));
    revalidatePath("/admin/shifts");
    return `Legend ${data.code} created (${formatHours(data.paidMinutes)} paid hours)`;
  });
}

// Schedules store a copy of the hours, so editing a legend never changes past days.
export async function updateShift(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const id = z.uuid().parse(form.get("id"));
    const data = parse(form);
    const active = form.get("active") === "on";
    await withActor(me.id, (tx) => tx.update(shiftTemplates).set({ ...data, active }).where(eq(shiftTemplates.id, id)));
    revalidatePath("/admin/shifts");
    return `Saved – ${formatHours(data.paidMinutes)} paid hours`;
  });
}
