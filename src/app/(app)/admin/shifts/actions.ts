"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { shiftTemplates } from "@/db/schema";
import { withActor } from "@/lib/actor";
import { run, type ActionState } from "@/lib/action-state";
import { canEditStaffOf, getCurrentUser, PEOPLE_ADMINS, type CurrentUser } from "@/lib/session";
import { AppError } from "@/lib/app-error";
import { db } from "@/db/client";
import { formatHours } from "@/lib/shifts";
import { legendFields, legendHours } from "@/lib/legend-input";

/**
 * Admin/owner/GM manage every legend; a department manager manages the legends of their own
 * departments (hotel-wide legends stay with owner/GM).
 */
async function mayEdit(departmentId: string | null): Promise<CurrentUser> {
  const me = await getCurrentUser();
  if (!me) throw new AppError("notSignedIn");
  if (PEOPLE_ADMINS.includes(me.role)) return me;
  if (!departmentId || !(await canEditStaffOf(me, departmentId))) throw new AppError("notAllowed");
  return me;
}

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
    const data = parse(form);
    const me = await mayEdit(data.departmentId);
    await withActor(me.id, (tx) => tx.insert(shiftTemplates).values(data));
    revalidatePath("/admin/shifts");
    return (await getTranslations("shifts"))("created", { code: data.code, hours: formatHours(data.paidMinutes) });
  });
}

// Schedules store a copy of the hours, so editing a legend never changes past days.
export async function updateShift(_: ActionState, form: FormData): Promise<ActionState> {
  return run(async () => {
    const id = z.uuid().parse(form.get("id"));
    const data = parse(form);
    const current = await db.query.shiftTemplates.findFirst({ where: eq(shiftTemplates.id, id) });
    if (!current) throw new AppError("unknownLegend");
    await mayEdit(current.departmentId);
    const me = await mayEdit(data.departmentId);
    const active = form.get("active") === "on";
    await withActor(me.id, (tx) => tx.update(shiftTemplates).set({ ...data, active }).where(eq(shiftTemplates.id, id)));
    revalidatePath("/admin/shifts");
    return (await getTranslations("shifts"))("savedHours", { hours: formatHours(data.paidMinutes) });
  });
}
