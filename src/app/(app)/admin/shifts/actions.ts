"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { shiftTemplates } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { assertRole, PEOPLE_ADMINS } from "@/lib/session";
import { formatHours } from "@/lib/shifts";
import { legendFields, legendHours } from "@/lib/legend-input";

const ADMINS = PEOPLE_ADMINS;

const fields = legendFields.extend({
  departmentId: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(z.uuid().nullable()),
});

function parse(form: FormData) {
  const data = fields.parse(Object.fromEntries(form));
  return { ...data, ...legendHours(String(form.get("segments") ?? ""), data.breakMinutes) };
}

export async function createShift(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await assertRole(ADMINS);
    const data = parse(form);
    await withActor(me.id, (tx) => tx.insert(shiftTemplates).values(data));
    revalidatePath("/admin/shifts");
    return (await getTranslations("shifts"))("created", { code: data.code, hours: formatHours(data.paidMinutes) });
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
    return (await getTranslations("shifts"))("savedHours", { hours: formatHours(data.paidMinutes) });
  });
}
